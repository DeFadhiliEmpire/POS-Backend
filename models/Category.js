const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },

    categoryUid: {
      type: String,
      required: true,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    normalizedName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    version: { type: Number, default: 1, min: 1 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  },
);

categorySchema.pre("validate", function (next) {
  if (this.name) {
    this.normalizedName = this.name.trim().normalize("NFKC").toLowerCase();
  }
});

//unique category UID within a business
categorySchema.index({ businessId: 1, categoryUid: 1 }, { unique: true });

categorySchema.index({ businessId: 1, normalizedName: 1 }, { unique: true });

//incremental catalogue sync
categorySchema.index({ businessId: 1, updatedAt: 1 });

const Category = mongoose.model("Category", categorySchema);

module.exports = Category;
