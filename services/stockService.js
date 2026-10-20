const mongoose = require("mongoose");

const Product = require("../models/Product.js");
const StockMovement = require("../models/StockMovement.js");

const createStockMovement = async ({
  businessId,
  productId,
  performedBy,
  deviceId,
  type,
  quantity,
  note,
}) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    if (!businessId) {
      throw new Error("Business ID is required");
    }

    if (!productId) {
      throw new Error("Product ID is required");
    }

    if (!type) {
      throw new Error("Stock movement type is required");
    }
    if (quantity === undefined || quantity <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const allowedTypes = [
      "purchase",
      "sale",
      "sale_reversal",
      "return",
      "damage",
      "adjustment",
      "transfer_in",
      "transfer_out",
    ];

    if (!allowedTypes.includes(type)) {
      throw new Error("Invalid stock movement type");
    }

    const product = await Product.findOne({
      _id: productId,
      businessId,
      isActive: true,
    }).session(session);

    if (!product) {
      const error = new Error("Product not found");
      error.statusCode = 404;
      throw error;
    }

    let direction = "in";

    if (type === "damage") {
      direction = "out";
    }

    if (direction === "out" && product.stockQuantity < quantity) {
      const error = new Error("Insufficient stock");
      error.statusCode = 409;
      throw error;
    }

    if (direction === "in") {
      product.stockQuantity += quantity;
    } else {
      product.stockQuantity -= quantity;
    }

    await product.save({ session });

    const clientMovementId = `MANUAL-${Date.now()}-${product._id}`;

    const stockMovement = new StockMovement({
      businessId,
      product: product._id,
      type,
      quantity,
      direction,
      referenceType: "manual",
      performedBy,
      deviceId: deviceId || "web",
      clientMovementId,
      occurredAt: new Date(),
      note,
    });

    await stockMovement.save({ session });
    await session.commitTransaction();

    return { product, stockMovement };
  } catch (err) {
    await session.abortTransaction();

    throw err;
  } finally {
    await session.endSession();
  }
};

module.exports = { createStockMovement };
