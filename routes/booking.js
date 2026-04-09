const router = require("express").Router();
const pool = require("../db");
const twilio = require("twilio");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Initialize Twilio
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create the email sender
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify(function (error, success) {
  if (error) {
    console.log("⚠️ Nodemailer Connection Error:", error);
  } else {
    console.log("✅ Nodemailer is ready to send messages!");
  }
});

const sendBookingMessage = async (
  name,
  pickup,
  duration,
  paymentMethod,
  phone,
  email,
) => {
  const messageBody = `
🚖 *New Booking Confirmed!*

👤 *Name:* ${name}
📍 *Pickup:* ${pickup}
⏳ *Duration:* ${duration} Hours
💳 *Payment:* ${paymentMethod}
📞 *Phone:* +${phone}
✉️ *Email:* ${email}

A driver will be assigned to you shortly

Ref: #${Date.now().toString().slice(-6)}`;

  // Twilio
  await client.messages.create({
    body: messageBody,
    from: "whatsapp:" + process.env.TWILIO_PHONE_NUMBER,
    to: `whatsapp:+${phone}`,
  });

  // Email
  await transporter.sendMail({
    from: '"SafarSaathi Admin" <safarsaathi.cab@gmail.com>',
    to: email,
    subject: "Your SafarSaathi Ride is Confirmed! 🚖",
    text: messageBody,
  });
};

// 1. CREATE BOOKING & ORDER ROUTE

router.post("/", async (req, res) => {
  try {
    const { name, pickup, phone, email, duration, paymentMethod, coordinates } =
      req.body;

    const amount = duration * 200;

    const newBooking = await pool.query(
      "INSERT INTO bookings (user_name, pickup_location, phone, email, duration, payment_method, latitude, longitude, amount, payment_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid') RETURNING *",
      [
        name,
        pickup,
        phone,
        email,
        duration,
        paymentMethod,
        coordinates?.lat,
        coordinates?.lon,
        amount,
      ],
    );

    const bookingId = newBooking.rows[0].booking_id;

    if (paymentMethod === "Online") {
      // Create Razorpay Order
      const options = {
        amount: amount * 100,
        currency: "INR",
        receipt: bookingId.toString().substring(0, 40),
      };

      const order = await razorpay.orders.create(options);

      // Save the Razorpay Order ID to the database
      await pool.query(
        "UPDATE bookings SET razorpay_order_id = $1 WHERE booking_id = $2",
        [order.id, bookingId],
      );

      // Send order details back to frontend to trigger popup
      return res.json({
        requiresPayment: true,
        order,
        bookingId,
        key: process.env.RAZORPAY_KEY_ID,
      });
    } else {
      await sendBookingMessage(
        name,
        pickup,
        duration,
        paymentMethod,
        phone,
        email,
      );

      return res.json({
        requiresPayment: false,
        success: true,
        message: "Booking saved and SMS sent!",
        bookingId,
      });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

router.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
    } = req.body;

    // 1. Verify the Signature to prevent fraud
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      // 2. Signature matches, Update DB to 'paid'
      const updatedBooking = await pool.query(
        "UPDATE bookings SET payment_status = 'paid', razorpay_payment_id = $1 WHERE booking_id = $2 RETURNING *",
        [razorpay_payment_id, bookingId],
      );

      const booking = updatedBooking.rows[0];

      await sendBookingMessage(
        booking.user_name,
        booking.pickup_location,
        booking.duration,
        booking.payment_method,
        booking.phone,
        booking.email,
      );

      res.json({ success: true, message: "Payment verified successfully" });
    } else {
      res
        .status(400)
        .json({ success: false, message: "Invalid digital signature" });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

router.post("/cancel-booking", async (req, res) => {
  try {
    const { bookingId } = req.body;

    // Delete the unpaid booking
    await pool.query(
      "DELETE FROM bookings WHERE booking_id = $1 AND payment_status = 'unpaid'",
      [bookingId],
    );

    res.json({ success: true, message: "Abandoned booking cleared." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

module.exports = router;
