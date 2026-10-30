const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
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

    description: {
      type: String,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    version: { type: Number, default: 1, min: 1 },
  },
  {
    timestamps: true,
  },
);

categorySchema.index({ businessId: 1, name: 1 }, { unique: true });

categorySchema.index({ businessId: 1, updatedAt: 1 });

const Category = mongoose.model("Category", categorySchema);

module.exports = Category;
