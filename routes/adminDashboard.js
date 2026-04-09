const router = require("express").Router();
const pool = require("../db");
const authorize = require("../middleware/authorization");
const twilio = require("twilio");
const admin = require("../middleware/admin");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Inititate Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Initiate email
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Get Dashboard Stats
router.get("/stats", authorize, admin, async (req, res) => {
  try {
    const bookingCount = await pool.query("SELECT COUNT(*) FROM bookings");
    const driverCount = await pool.query(
      "SELECT COUNT(*) FROM users WHERE role = 'driver'",
    );
    const appCount = await pool.query(
      "SELECT COUNT(*) FROM driver_applications WHERE status = 'pending'",
    );
    const revenue = await pool.query(
      "SELECT SUM(duration) * 500 as total FROM bookings",
    ); // Assuming 500/hr

    res.json({
      totalBookings: bookingCount.rows[0].count,
      activeDrivers: driverCount.rows[0].count,
      pendingApps: appCount.rows[0].count,
      revenue: revenue.rows[0].total || 0,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// Get All Bookings
router.get("/bookings", authorize, admin, async (req, res) => {
  try {
    // Get latest bookings first
    const result = await pool.query(
      "SELECT * FROM bookings ORDER BY created_at DESC",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// DELETE a pending booking
router.delete("/bookings/:id", authorize, admin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM bookings WHERE booking_id = $1", [id]);
    res.json({ message: "Booking deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// Get All Driver Applications
router.get("/applications", authorize, admin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM driver_applications ORDER BY applied_at DESC",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// Approve/Reject Driver
router.put("/applications/:id", authorize, admin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1. Update Application Status
    const updateApp = await pool.query(
      "UPDATE driver_applications SET status = $1 WHERE application_id = $2 RETURNING *",
      [status, id],
    );

    const application = updateApp.rows[0];

    // 2. If Approved, Upgrade/Create User
    if (status === "approved" && application) {
      const { email, full_name, phone, car_model, license_number } =
        application;

      let userId;

      const userCheck = await pool.query(
        "SELECT user_id FROM users WHERE email = $1",
        [email],
      );

      if (userCheck.rows.length > 0) {
        userId = userCheck.rows[0].user_id;

        await pool.query(
          "UPDATE users SET role = 'driver', phone_number = $2 WHERE email = $1",
          [email, phone],
        );
      } else {
        // User does not exist, Create new account
        const salt = await bcrypt.genSalt(10);
        const bcryptPassword = await bcrypt.hash("driver123", salt);

        const newUser = await pool.query(
          "INSERT INTO users (full_name, email, password_hash, phone_number, role) VALUES ($1, $2, $3, $4, 'driver') RETURNING user_id",
          [full_name, email, bcryptPassword, phone],
        );

        // Grab the new ID
        userId = newUser.rows[0].user_id;
      }

      await pool.query(
        `INSERT INTO driver_profiles (user_id, car_model, license_number, is_available) 
        VALUES ($1, $2, $3, true)
        ON CONFLICT (user_id) DO UPDATE 
        SET car_model = EXCLUDED.car_model, license_number = EXCLUDED.license_number`,
        [userId, car_model, license_number],
      );
    }

    res.json({ message: "Driver approved and account updated", application });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// 1. Get all approved drivers (to show in a dropdown)
router.get("/drivers", authorize, admin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT user_id, full_name, phone_number FROM users WHERE role = 'driver'",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json("Server Error");
  }
});

// GET All Registered Drivers with Car Details & Trip Count
router.get("/drivers-list", authorize, admin, async (req, res) => {
  try {
    const drivers = await pool.query(
      `SELECT 
        u.user_id, 
        u.full_name, 
        u.email, 
        u.phone_number, 
        u.created_at,
        dp.car_model, 
        dp.license_number,
        dp.is_available,
        COALESCE(COUNT(b.booking_id), 0) AS total_trips
      FROM users u
      LEFT JOIN driver_profiles dp ON u.user_id = dp.user_id
      LEFT JOIN bookings b ON u.user_id = b.driver_id AND b.status = 'completed'
      WHERE u.role = 'driver'
      GROUP BY 
        u.user_id, 
        dp.car_model, 
        dp.license_number, 
        dp.is_available
      ORDER BY total_trips DESC`,
    );

    res.json(drivers.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

// Assign Driver & Send SMS
router.put("/assign-driver", authorize, admin, async (req, res) => {
  try {
    const { booking_id, driver_id } = req.body;

    const endRidePin = Math.floor(1000 + Math.random() * 9000).toString();

    const updatedBooking = await pool.query(
      "UPDATE bookings SET status = 'confirmed', driver_id = $1, end_ride_pin = $2 WHERE booking_id = $3 RETURNING *",
      [driver_id, endRidePin, booking_id],
    );

    const booking = updatedBooking.rows[0];

    const driverQuery = await pool.query(
      `SELECT u.full_name, u.phone_number, dp.car_model, dp.license_number 
       FROM users u JOIN driver_profiles dp ON u.user_id = dp.user_id 
       WHERE u.user_id = $1`,
      [driver_id],
    );
    const driver = driverQuery.rows[0];

    const messageBody = `
✅ *Driver Assigned!*

👤 *Driver:* ${driver.full_name}
🚗 *Vehicle:* ${driver.car_model || "Not specified"}
📋 *Plate:* ${driver.license_number || "Not specified"}
📞 *Contact:* +91${driver.phone_number}

🔒 *SECURITY PIN:* ${endRidePin}
(Please give this 4-digit PIN to your driver ONLY when you have reached your destination to complete the ride.)
    `;

    await client.messages.create({
      body: messageBody,
      from: "whatsapp:" + process.env.TWILIO_PHONE_NUMBER,
      to: `whatsapp:+${booking.phone}`,
    });

    await transporter.sendMail({
      from: '"SafarSaathi Admin" <safarsaathi.cab@gmail.com>',
      to: booking.email,
      subject: "Your SafarSaathi Ride is Confirmed! 🚖",
      text: messageBody,
    });

    res.json({ message: "Driver assigned and user notified!" });
  } catch (err) {
    console.error("Assignment Error:", err.message);
    res.status(500).json("Server Error");
  }
});

module.exports = router;
