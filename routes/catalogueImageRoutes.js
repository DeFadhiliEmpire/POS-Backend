const express = require("express");
const cloudinary = require("../config/cloudinary");

const authenticateJWT = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/roleMiddleware");
const upload = require("../middleware/catalogueImageUpload");

const router = express.Router();

const canManageCatalogue = authorizeRoles("owner", "manager");

router.post(
  "/uploads/catalogue-image",
  authenticateJWT,
  canManageCatalogue,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select an image.",
        });
      }

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "supermarket-pos/catalogue",
            resource_type: "image",
            allowed_formats: ["jpg", "jpeg", "png", "webp"],
            transformation: [
              {
                width: 1000,
                height: 1000,
                crop: "limit",
              },
              {
                quality: "auto",
                fetch_format: "auto",
              },
            ],
          },
          (error, uploadedImage) => {
            if (error) return reject(error);
            resolve(uploadedImage);
          },
        );

        stream.end(req.file.buffer);
      });

      return res.status(201).json({
        success: true,
        message: "Image uploaded successfully.",
        image: {
          imageUrl: result.secure_url,
          imagePublicId: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
        },
      });
    } catch (error) {
      console.error("Catalogue image upload error:", error);

      return res.status(500).json({
        success: false,
        message: "Image upload failed.",
      });
    }
  },
);

// Handle upload middleware errors, including file-size errors.
router.use((error, _req, res, next) => {
  if (error instanceof require("multer").MulterError) {
    return res.status(400).json({
      success: false,
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Image must not exceed 2MB."
          : "Invalid image upload.",
    });
  }

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Invalid image.",
    });
  }

  next();
});

module.exports = { router };
