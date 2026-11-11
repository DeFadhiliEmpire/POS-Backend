function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, message: "Authentication required" });
      }

      const userRole = String(req.user.role || "")
        .trim()
        .toUpperCase();

      const permittedRoles = allowedRoles.map((role) =>
        String(role).trim().toUpperCase(),
      );

      if (!permittedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to perform this action",
        });
      }

      next();
    } catch (err) {
      console.error("Authorization error:", err);

      return res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  };
}

module.exports = authorizeRoles;
