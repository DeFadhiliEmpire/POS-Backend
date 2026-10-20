const express = require("express");
const Product = require("../models/Product.js");
const StockMovement = require("../models/StockMovement.js");
const { createStockMovement } = require("../services/stockService.js");
const authenticateJWT = require("../middleware/authenticate.js");

const router = express.Router();

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
router.post("/products/add", authenticateJWT, async (req, res) => {
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
      stockQuantity: stockQuantity || 0,
      lowStockThreshold:
        lowStockThreshold !== undefined ? lowStockThreshold : 5,
      unit: unit || "piece",
      image,
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
      image,
      isActive,
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

    const product = await Product.findOne({
      _id: productId,
      businessId,
    });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
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

    product.name = name;
    product.sku = sku;
    product.barcode = barcode;
    product.category = category;
    product.buyingPrice = buyingPrice;
    product.sellingPrice = sellingPrice;

    if (lowStockThreshold !== undefined) {
      product.lowStockThreshold = lowStockThreshold;
    }

    if (unit !== undefined) {
      product.unit = unit;
    }

    if (image !== undefined) {
      product.image = image;
    }

    if (isActive !== undefined) {
      product.isActive = isActive;
    }

    if (buyingPrice < 0 || sellingPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Prices cannot be negative",
      });
    }

    await product.save();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product,
    });
  } catch (err) {
    console.error("Error Updating product:", err);

    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//deactivate a procuct
router.delete("/products/:id", authenticateJWT, async (req, res) => {
  try {
    if (!req.user || !req.user.businessId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated business user required",
      });
    }

    const businessId = req.user.businessId;
    const productId = req.params.id;

    const product = await Product.findOne({ _id: productId, businessId });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    if (!product.isActive) {
      return res
        .status(400)
        .json({ success: false, message: "Product is already inactive" });
    }

    product.isActive = false;

    await product.save();

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

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = { router };
