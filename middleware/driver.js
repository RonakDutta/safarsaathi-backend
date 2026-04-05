module.exports = async (req, res, next) => {
  try {
    if (req.user.role !== "driver") {
      return res.status(403).json({ error: "Access Denied: Drivers Only" });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
};
