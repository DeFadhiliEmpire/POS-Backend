const express = require("express");
const Category = require("../models/Category.js");
const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();

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

    res.json({ success: true, categories });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
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

// Update a category
router.put(
  "/category/:id",
  authenticateJWT,
  authorizeRoles("owner"),
  async (req, res) => {
    try {
      const { name, isActive, description } = req.body;

      const category = await Category.findOneAndUpdate(
        { _id: req.params.id, businessId: req.user.businessId },
        { $set: { name, isActive, description } },
        { new: true },
      );

      if (!category) {
        return res
          .status(404)
          .json({ success: false, message: "Category not found" });
      }

      res.json({
        success: true,
        message: "Category updated successfully",
        category,
      });
    } catch (error) {
      console.error("Update category error:", error);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  },
);

// Delete a category
router.delete(
  "/category/:id",
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

      const category = await Category.findOneAndDelete({
        _id: req.params.id,
        businessId: req.user.businessId,
      });

      if (!category) {
        return res
          .status(404)
          .json({ success: false, message: "Category not found" });
      }

      res.json({ success: true, message: "Category deleted successfully" });
    } catch (err) {
      console.error("Delete category error:", err);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  },
);

module.exports = { router };
