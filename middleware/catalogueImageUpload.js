const multer = require("multer");

const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.includes(file.mimetype)) {
      return callback(new Error("Only JPG, PNG and WEBP images are allowed."));
    }

    callback(null, true);
  },
});

module.exports = upload;
