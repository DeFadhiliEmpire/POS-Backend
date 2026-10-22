const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    phone: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["owner", "manager", "cashier", "admin"],
      default: "cashier",
    },
    isMfaEnabled: { type: Boolean, default: false },
    mfaSecretEncrypted: { type: String, select: false },
    oauthProvider: { type: String, enum: ["google", null], default: null },
    oauthId: { type: String, default: null, index: true },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

module.exports = { User };
