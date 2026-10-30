const express = require("express");
const mongoose = require("mongoose");
const Category = require("../models/Category.js");
const Product = require("../models/Product.js");
const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();
const canManage = authorizeRoles("owner", "manager");

const handleError = (res, error, message) => {
  console.error(message, err);

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A category with this name already exists",
    });
  }

  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

//get all categories for a business
router.get("/category", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const categories = await Category.find({
      businessId: req.user.businessId,
      isActive: true,
    }).sort({ name: 1 });

    return res.status(200).json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    return handleError(res, error, "Get categories error");
  }
});

router.get("/category/:id", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    }

    const categoryId = req.params.id;
    const businessId = req.user.businessId;

    const category = await Category.findOne({ _id: categoryId, businessId });

    if (!category) {
      return res
        .status(404)
        .json({ success: false, message: "Category  not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Category retrieved successfully",
      category,
    });
  } catch (error) {
    console.error("Error finding category by ID:", error);

    return res
      .status(500)
      .json({ success: false, message: "Internal server Error" });
  }
});

//create category
router.post(
  "/category/add",
  authenticateJWT,
  authorizeRoles("owner"),
  async (req, res) => {
    try {
      if (!req.user || !req.user.businessId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated business user required",
        });
      }

      const { name, description } = req.body;

      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "Category name is required" });
      }

      const category = new Category({
        name: name.trim(),
        businessId: req.user.businessId,
        description,
        isActive: true,
      });

      await category.save();

      res.status(201).json({
        success: true,
        message: "Category created successfully",
        category,
      });
    } catch (error) {
      console.error("Create category error:", error);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  },
);

// Update a category with optimistic version check
router.put("/category/:id", authenticateJWT, canManage, async (req, res) => {
  try {
    const { name, isActive, description, expectedVersion } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    }

    if (!Number.isInteger(expectedVersion)) {
      return res.status(400).json({
        success: false,
        message: "expectedVersion is required",
      });
    }

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const category = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        businessId: req.user.businessId,
        isActive: true,
        version: expectedVersion,
      },
      { $set: { name, isActive, description }, $inc: { version: 1 } },
      { new: true, runValidators: true },
    );
    if (!category) {
      const current = await Category.findOne({
        _id: req.params.id,
        businessId: req.user.businessId,
      });

      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "Category not found" });
      }

      return res.status(409).json({
        success: false,
        message: "Category version conflict. Refresh before editing.",
        currentVersion: current.version,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    console.error("Update category error:", error);
    return handleError(res, error, "Update category error");
  }
});

// Delete a category
router.delete("/category/:id", authenticateJWT, canManage, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const { expectedVersion } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid category ID" });
    }

    if (!Number.isInteger(expectedVersion)) {
      return res.status(400).json({
        success: false,
        message: "expectedVersion is required",
      });
    }

    const activeProducts = await Product.countDocuments({
      businessId: req.user.businessId,
      category: req.params.id,
      isActive: true,
    });

    if (activeProducts > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Move active products to another category before deactivating this category",
        activeProducts,
      });
    }

    const category = await Category.findOneAndUpdate(
      {
        _id: req.params.id,
        businessId: req.user.businessId,
        isActive: true,
        version: expectedVersion,
      },
      {
        $set: { isActive: false },
        $inc: { version: 1 },
      },
      { new: true },
    );

    if (!category) {
      const current = await Category.findOne({
        _id: req.params.id,
        businessId: req.user.businessId,
      });

      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "Category not found" });
      }

      return res.status(409).json({
        success: false,
        message: "Category version conflict or already inactive",
        currentVersion: current.version,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Category deactivated successfully",
      category,
    });
  } catch (error) {
    console.error("Delete category error:", err);
    return handleError(res, error, "Deactivate category error");
  }
});

module.exports = { router };
