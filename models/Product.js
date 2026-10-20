const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    barcode: {
      type: String,
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    buyingPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    lowStockThreshold: {
      type: Number,
      min: 0,
      default: 5,
    },
    stockQuantity: {
      type: Number,
      min: 0,
    },
    unit: {
      type: String,
      enum: ["piece", "kg", "g", "liter", "ml", "box", "pack", "dozen"],
      default: "piece",
    },
    imageUrl: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  },
);

productSchema.index({ businessId: 1, sku: 1 }, { unique: true });

productSchema.index({ businessId: 1, barcode: 1 });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
