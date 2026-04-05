const router = require("express").Router();
const pool = require("../db");
const authorize = require("../middleware/authorization");

router.post("/", async (req, res) => {
  try {
    const { name, email, phone, carModel, licenseNumber } = req.body;

    if (!name || !email || !phone || !carModel || !licenseNumber) {
      return res.status(400).json({ error: "Please fill in all fields" });
    }

    const newApplication = await pool.query(
      "INSERT INTO driver_applications (full_name, email, phone, car_model, license_number) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, email, phone, carModel, licenseNumber],
    );

    res.json({
      success: true,
      message: "Application received!",
      data: newApplication.rows[0],
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Server Error" });
  }
});

router.get("/my-application-status", authorize, async (req, res) => {
  try {
    const userQuery = await pool.query(
      "SELECT email FROM users WHERE user_id = $1",
      [req.user],
    );
    const userEmail = userQuery.rows[0].email;

    const appQuery = await pool.query(
      "SELECT status FROM driver_applications WHERE email = $1 ORDER BY application_id DESC LIMIT 1",
      [userEmail],
    );

    if (appQuery.rows.length > 0) {
      res.json({ status: appQuery.rows[0].status });
    } else {
      res.json({ status: null });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json("Server Error");
  }
});

module.exports = router;
