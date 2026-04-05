const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

app.use("/auth", require("./routes/jwtAuth"));
app.use("/api/book-ride", require("./routes/booking"));
app.use("/api/driver-apply", require("./routes/driver"));
app.use("/api/admin", require("./routes/adminDashboard"));
app.use("/api/driver-board", require("./routes/driverDashboard"));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
