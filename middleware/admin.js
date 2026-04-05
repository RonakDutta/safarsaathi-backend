module.exports = async (req, res, next) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Access Denied: Admins Only" });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
};
