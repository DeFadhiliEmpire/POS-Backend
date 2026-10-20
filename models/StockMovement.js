const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "purchase",
        "sale",
        "sale_reversal",
        "return",
        "damage",
        "adjustment",
        "transfer_in",
        "transfer_out",
      ],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },
    referenceType: {
      type: String,
      enum: ["sale", "purchase", "return", "adjustment", "transfer", "manual"],
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    clientMovementId: {
      type: String,
      required: true,
    },
    note: {
      type: String,
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

stockMovementSchema.index(
  {
    businessId: 1,
    clientMovementId: 1,
  },
  {
    unique: true,
  },
);

stockMovementSchema.index({
  businessId: 1,
  product: 1,
  occurredAt: 1,
});

const StockMovement = mongoose.model("StockMovement", stockMovementSchema);

module.exports = StockMovement;
