const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product.js");
const Category = require("../models/Category.js");
//const StockMovement = require("../models/StockMovement.js");
const { createStockMovement } = require("../services/stockService.js");
const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();
const canManage = authorizeRoles("owner", "manager");

const validId = (id) => mongoose.Types.ObjectId.isValid(id);

const validateCategory = async (categoryId, businessId) => {
  if (!validId(categoryId)) return false;

  return Boolean(
    await Category.exists({
      _id: categoryId,
      businessId,
      isActive: true,
    }),
  );
};

const handleError = (res, err, message) => {
  console.error(message, err);

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "SKU, barcode or another unique value already exists",
    });
  }

  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

//get products
router.get("/products", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const businessId = req.user.businessId;
    const products = await Product.find({ businessId, isActive: true })
      .populate("category", "name")
      .sort({ name: 1 });

    return res.status(200).json({
      success: true,
      message: "Products retrieved successfully",
      products,
    });
  } catch (err) {
    console.error("Get products error:", err);

    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//fetch product by id
router.get("/products/:id", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    if (!validId(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product ID" });
    }

    const businessId = req.user.businessId;
    const productId = req.params.id;

    const product = await Product.findOne({
      _id: productId,
      businessId,
    }).populate("category", "name");

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Product retrieved successfully",
      product,
    });
  } catch (err) {
    console.error("Get product error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

//create products and add
router.post("/products/add", canManage, authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }
    const businessId = req.user.businessId;

    const {
      name,
      sku,
      barcode,
      category,
      buyingPrice,
      sellingPrice,
      stockQuantity,
      lowStockThreshold,
      unit,
      image,
    } = req.body;

    if (!name || !sku || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, SKU and category are required",
      });
    }

    if (buyingPrice < 0 || sellingPrice < 0) {
      return res
        .status(400)
        .json({ success: false, message: "Price cannot be negative" });
    }

    if (stockQuantity !== undefined && stockQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: "Stock quantity cannot be negative ",
      });
    }

    if (!(await validateCategory(category, req.user.businessId))) {
      return res.status(400).json({
        success: false,
        message: "Category is invalid, inactive or belongs to another business",
      });
    }

    const existingProduct = await Product.findOne({
      businessId,
      sku: sku.toUpperCase(),
    });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "A product with this SKU already exists",
      });
    }

    const product = new Product({
      businessId,
      name,
      sku: sku.toUpperCase(),
      barcode,
      category,
      buyingPrice,
      sellingPrice,
      lowStockThreshold:
        lowStockThreshold !== undefined ? lowStockThreshold : 5,
      unit: unit || "piece",
      imageUrl,
      stockQuantity: stockQuantity || 0,
      y,
      version: 1,
      isActive: true,
    });

    await product.save();

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      product,
    });
  } catch (err) {
    console.error("Create product error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error while creating product",
    });
  }
});

//update existing product
router.put("/products/:id", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    if (!validId(req.params.id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product ID" });
    }

    const { expectedVersion } = req.body;

    if (!Number.isInteger(expectedVersion)) {
      return res.status(400).json({
        success: false,
        message: "expectedVersion is required",
      });
    }

    const businessId = req.user.businessId;
    const productId = req.params.id;

    const {
      name,
      sku,
      barcode,
      category,
      buyingPrice,
      sellingPrice,
      lowStockThreshold,
      unit,
      imageUrl,
    } = req.body;

    if (!name || !sku || !category) {
      return res.status(400).json({
        success: false,
        message: "Name, SKU and category are required",
      });
    }

    if (buyingPrice === undefined || sellingPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: "Buying price and selling price required",
      });
    }

    if (buyingPrice < 0 || sellingPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Prices cannot be negative",
      });
    }

    if (lowStockThreshold !== undefined && lowStockThreshold < 0) {
      return res.status(400).json({
        success: false,
        message: "Low stock threshold cannot be negative",
      });
    }

    if (!(await validateCategory(category, req.user.businessId))) {
      return res.status(400).json({
        success: false,
        message: "Category is invalid, inactive or belongs to another business",
      });
    }

    const existingProduct = await Product.findOne({
      businessId,
      sku: sku.toUpperCase(),
      _id: { $ne: productId },
    });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "Another product with this SKU already exists",
      });
    }

    const product = await Product.findOneAndUpdate(
      {
        _id: req.params.id,
        businessId: req.user.businessId,
        isActive: true,
        version: expectedVersion,
      },
      {
        $set: {
          name: name.trim(),
          sku: sku.trim().toUpperCase(),
          barcode,
          category,
          buyingPrice,
          sellingPrice,
          ...(lowStockThreshold !== undefined && { lowStockThreshold }),
          ...(unit !== undefined && { unit }),
          ...(imageUrl !== undefined && { imageUrl }),
        },
        $inc: { version: 1 },
      },
      { new: true, runValidators: true },
    );

    if (!product) {
      const current = await Product.findOne({
        _id: req.params.id,
        businessId: req.user.businessId,
      });

      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });
      }

      return res.status(409).json({
        success: false,
        message: "Product version conflict. Refresh before editing.",
        currentVersion: current.version,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product,
    });
  } catch (err) {
    console.error("Error Updating product:", err);

    return handleError(res, err, "Update product error");
  }
});

//deactivate a procuct
router.delete("/products/:id", authenticateJWT, canManage, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const { expectedVersion } = req.body;

    if (!Number.isInteger(expectedVersion)) {
      return res.status(400).json({
        success: false,
        message: "expectedVersion is required",
      });
    }

    const businessId = req.user.businessId;
    const productId = req.params.id;

    const product = await Product.findOneAndUpdate(
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

    if (!product) {
      const current = await Product.findOne({
        _id: req.params.id,
        businessId: req.user.businessId,
      });

      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "Product not found" });
      }

      return res.status(409).json({
        success: false,
        message: "Product version conflict or already inactive",
        currentVersion: current.version,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product deactivated successfully",
      product,
    });
  } catch (err) {
    console.error("Delete product error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//stockMovement
router.post("/products/:id/stock", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const businessId = req.user.businessId;
    const performedBy = req.user._id;

    const { type, quantity, note } = req.body;

    const deviceId = req.headers["x-device-id"] || "web";

    const result = await createStockMovement({
      businessId,
      productId: req.params.id,
      performedBy,
      deviceId,
      type,
      quantity,
      note,
    });

    return res.status(201).json({
      success: true,
      message: "Stock movement created successfully",
      product: result.product,
      stockMovement: result.stockMovement,
    });
  } catch (err) {
    console.error("Stock movement error:", err);

    return handleError(res, err, "Stock movement error");
  }
});

module.exports = { router };
