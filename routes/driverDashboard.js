const router = require("express").Router();
const pool = require("../db");
const authorize = require("../middleware/authorization");
const driver = require("../middleware/driver");

router.get("/my-trips", authorize, driver, async (req, res) => {
  try {
    const bookings = await pool.query(
      "SELECT * FROM bookings WHERE driver_id = $1 ORDER BY created_at DESC",
      [req.user.id],
    );

    const stats = await pool.query(
      "SELECT COUNT(*) FROM bookings WHERE driver_id = $1 AND status = 'completed'",
      [req.user.id],
    );

    res.json({
      bookings: bookings.rows,
      completedCount: stats.rows[0].count,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

router.put("/complete/:id", authorize, async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;

    const bookingQuery = await pool.query(
      "SELECT end_ride_pin FROM bookings WHERE booking_id = $1",
      [id],
    );

    if (bookingQuery.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const correctPin = bookingQuery.rows[0].end_ride_pin;

    if (correctPin !== pin) {
      return res.status(400).json({
        error:
          "Incorrect Security PIN. Ask the customer for the 4-digit code sent to their WhatsApp.",
      });
    }

    await pool.query(
      "UPDATE bookings SET status = 'completed' WHERE booking_id = $1",
      [id],
    );

    res.json({ message: "Ride successfully completed!" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

router.put("/cancel/:id", authorize, driver, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "UPDATE bookings SET status = 'pending', driver_id = NULL WHERE booking_id = $1",
      [id],
    );
    res.json({ message: "Ride cancelled and returned to queue." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

module.exports = router;
