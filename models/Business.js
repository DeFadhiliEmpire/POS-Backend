const mongoose = require("mongoose");

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    businessType: {
      type: String,
      enum: [
        "supermarket",
        "retail",
        "wholesale",
        "restaurant",
        "pharmacy",
        "hardware",
        "other",
      ],
      default: "retail",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },

    country: {
      type: String,
      default: "Kenya",
      trim: true,
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
    },
    timezone: {
      type: String,
      default: "Africa/Nairobi",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const Business = mongoose.model("Business", businessSchema);

module.exports = Business;
