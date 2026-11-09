const express = require("express");
const mongoose = require("mongoose");
const Category = require("../models/Category.js");
const Product = require("../models/Product.js");
const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();
const canManage = authorizeRoles("owner", "manager");

const isValidUid = (uid) =>
  typeof uid === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    uid,
  );

const normalizeName = (name) => name.trim().normalize("NFKC").toLowerCase();

const handleError = (res, error, message) => {
  console.error(message, error);

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
router.get("/categories", authenticateJWT, async (req, res) => {
  try {
    const { businessId } = req.user;

    if (!req.user || !businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const includeInactive = req.query.includeInactive === "true";

    const filter = { businessId };

    if (!includeInactive) {
      filter.isActive = true;
    }

    const categories = await Category.find(filter).sort({ name: 1 }).lean();

    return res.status(200).json({
      success: true,
      categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);
    return handleError(res, error, "Get categories error");
  }
});

router.get("/categories/:categoryUid", authenticateJWT, async (req, res) => {
  try {
    const { businessId } = req.user;
    const { categoryUid } = req.params;

    if (!req.user || !businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    if (!isValidUid(categoryUid)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category UID",
      });
    }

    const category = await Category.findOne({ businessId, categoryUid }).lean();

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

    return handleError(res, error, "Get category by UID error");
  }
});

//create category
router.post("/categories/add", authenticateJWT, canManage, async (req, res) => {
  try {
    const { businessId, _id: userId } = req.user;

    const { categoryUid, name, description } = req.body;

    if (!businessId) {
      return res.status(401).json({
        success: false,
        message: "Business authentication required",
      });
    }

    if (!isValidUid(categoryUid)) {
      return res.status(400).json({
        success: false,
        message: "Valid categoryUid is required",
      });
    }

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const normalizedName = normalizeName(name);

    //idempotency check
    const existing = await Category.findOne({ businessId, categoryUid }).lean();

    if (existing) {
      if (existing.normalizedName !== normalizedName) {
        return res.status(409).json({
          success: false,
          message: "Category UID already exists with different data",
        });
      }

      return res.status(200).json({
        success: true,
        alreadyExists: true,
        category: existing,
      });
    }

    const category = new Category({
      businessId,
      categoryUid,
      name: name.trim(),
      normalizedName,
      description: description?.trim() || "",
      isActive: true,
      version: 1,
      createdBy: userId,
      updatedBy: userId,
    });

    await category.save();

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      category,
    });
  } catch (error) {
    console.error("Create category error:", error);
    return handleError(res, error, "Create category error");
  }
});

// Update a category with optimistic version check
router.patch(
  "/categories/:categoryUid",
  authenticateJWT,
  canManage,
  async (req, res) => {
    try {
      const { businessId, _id: userId } = req.user;
      const { categoryUid } = req.params;

      const { name, description, expectedVersion } = req.body;

      if (!isValidUid(categoryUid)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category UID",
        });
      }

      if (!Number.isInteger(expectedVersion)) {
        return res.status(400).json({
          success: false,
          message: "expectedVersion is required",
        });
      }

      const updates = { updatedBy: userId };

      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) {
          return res.status(400).json({
            success: false,
            message: "Valid category name is required",
          });
        }

        updates.name = name.trim();
        updates.normalizedName = normalizeName(name);
      }

      if (description !== undefined) {
        updates.description = description;
      }

      const category = await Category.findOneAndUpdate(
        {
          businessId,
          categoryUid,
          version: expectedVersion,
        },
        { $set: updates, $inc: { version: 1 } },
        { returnDocument: "after", runValidators: true },
      );

      if (!category) {
        const current = await Category.findOne({
          businessId,
          categoryUid,
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
          category: current,
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
  },
);

// Activate or Deactivate category
router.patch(
  "/categories/:categoryUid/status",
  authenticateJWT,
  canManage,
  async (req, res) => {
    try {
      const { businessId, _id: userId } = req.user;
      const { categoryUid } = req.params;

      if (!req.user || !businessId) {
        return res.status(401).json({
          success: false,
          message: "Authenticated business user required",
        });
      }

      const { isActive, expectedVersion } = req.body;

      if (!isValidUid(categoryUid)) {
        return res.status(400).json({
          success: false,
          message: "Invalid category UID",
        });
      }

      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isActive must be a boolean",
        });
      }

      if (!Number.isInteger(expectedVersion)) {
        return res.status(400).json({
          success: false,
          message: "expectedVersion is required",
        });
      }

      const current = Category.findOne({ businessId, categoryUid });

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      if (current.version !== expectedVersion) {
        return res.status(409).json({
          success: false,
          message: "Category version conflict",
          currentVersion: current.version,
          category: current,
        });
      }

      if (!isActive) {
        const activeProducts = await Product.countDocuments({
          businessId,
          category: current._id,
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
      }

      const category = await Category.findOneAndUpdate(
        {
          businessId,
          categoryUid,
          version: expectedVersion,
        },
        {
          $set: { isActive, updatedBy: userId },
          $inc: { version: 1 },
        },
        { returnDocument: "after", runValidators: true },
      );

      if (!category) {
        return res.status(409).json({
          success: false,
          message: "Category was modified by another user",
        });
      }

      return res.status(200).json({
        success: true,
        message: isActive
          ? "Category activated successfully"
          : "Category deactivated successfully",
        category,
      });
    } catch (error) {
      console.error("Delete category error:", error);
      return handleError(res, error, "Deactivate category error");
    }
  },
);

module.exports = { router };
