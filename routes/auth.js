require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const { User } = require("../models/User.js");
const Business = require("../models/Business.js");
const { RefreshToken } = require("../models/RefreshToken.js");

const {
  generateSecret,
  generateQRCode,
  encrypt,
  verifyToken,
} = require("../services/mfaServices.js");

const {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
} = require("../services/tokenService.js");

const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();

const OWNER_ROLE = "owner";

const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  CASHIER: "cashier",
  ADMIN: "admin",
};

//owner registration
router.post("/auth/signup", async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      name,
      email,
      password,
      phone,
      businessName,
      businessType,
      address,
      city,
      country,
      currency,
      timezone,
    } = req.body;

    if (!email || !password || !name || !phone || !businessName) {
      return res.status(400).json({
        message: "email,name,phone,businessName and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedBusinessName = businessName.trim().toUpperCase();

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    //generate secret for TOTP
    const secret = generateSecret(normalizedEmail, normalizedBusinessName);

    const encryptedSecret = encrypt(secret.base32);

    //start Transaction
    session.startTransaction();

    //create business
    const business = new Business({
      name: businessName.trim(),
      businessType: businessType || "retail",
      phone: phone.trim(),
      email: normalizedEmail,
      address: address?.trim(),
      city: city?.trim(),
      country: country || "Kenya",
      currency: currency || "KES",
      timezone: timezone || "Africa/Nairobi",
      isActive: true,
    });

    await business.save({ session });

    //Create Owner

    const owner = new User({
      businessId: business._id,
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      password: hashedPassword,
      isMfaEnabled: false,
      mfaSecretEncrypted: encryptedSecret,
      role: OWNER_ROLE,
      isActive: true,
    });

    await owner.save({ session });

    //connect Business to owner
    business.owner = owner._id;

    await business.save({ session });

    await session.commitTransaction();

    const qrCode = await generateQRCode(secret.otpauth_url);

    return res.status(201).json({
      success: true,
      message: "Business and owner created successfully",
      business: {
        id: business._id,
        name: business.name,
        businessType: business.businessType,
        currency: business.currency,
        timezone: business.timezone,
      },
      owner: {
        id: owner._id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        role: owner.role,
      },
      qrCode,
    });
  } catch (err) {
    await session.abortTransaction();

    console.error("Owner registration error:", err);

    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  } finally {
    await session.endSession();
  }
});

//verify  and enable MFA

router.post("/auth/verify-registration-mfa", async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: "User ID and MFA token required",
      });
    }

    const user = await User.findById(userId).select("+mfaSecretEncrypted");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.isMfaEnabled) {
      return res.status(400).json({ message: "MFA is already enabled" });
    }

    const valid = verifyToken(user.mfaSecretEncrypted, token);

    if (!valid) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid MFA token" });
    }

    user.isMfaEnabled = true;
    await user.save();

    res.json({
      success: true,
      message: "MFA enabled successfully. Your account is now active",
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify MFA enrollment" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and Password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password +mfaSecretEncrypted",
    );

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    if (!user.isActive) {
      return res
        .status(403)
        .json({ success: false, message: "Your account is inactive" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    if (!user.isMfaEnabled) {
      return res.status(403).json({
        success: false,
        message: "MFA enrollment is required before login ",
        mfaEnrolmentRequired: true,
        userId: user._id,
      });
    }

    const challange = jwt.sign(
      { userId: user._id.toString(), type: "mfa_challange" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );

    res.json({
      success: true,
      message: "Password verified. MFA verification required",
      mfaRequired: true,
      challange,
    });
  } catch (err) {
    console.error("Login error:", err);

    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

//verify MFA token and complete Login
router.post("/auth/verify-login-mfa", async (req, res) => {
  try {
    const { challenge, token } = req.body;

    if (!challenge || !token) {
      return res.status(400).json({
        success: false,
        message: "MFA challange and token are required",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(challenge, process.env.JWT_SECRET, {
        expiresIn: "5m",
      });
    } catch (error) {
      console.error(error);
      return res
        .status(401)
        .json({ success: false, message: "MFA challange expired or invalid " });
    }

    if (decoded.type !== "mfa_challange") {
      return res
        .status(401)
        .json({ success: false, message: "Invalid MFA challange" });
    }

    const user = await User.findById(decoded.userId).select(
      "+mfaSecretEncrypted",
    );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.isMfaEnabled) {
      return res
        .status(403)
        .json({ success: false, message: "MFA is not enabled" });
    }

    const valid = verifyToken(user.mfaSecretEncrypted, token);

    if (!valid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid MFA code" });
    }

    user.lastLogin = new Date();
    await user.save();

    const accessToken = createAccessToken(user);
    const refreshToken = await createRefreshToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      AccessToken: accessToken,
      RefreshToken: refreshToken,
    });
  } catch (error) {
    console.error("Login error:", err);
    return res
      .status(500)
      .json({ success: false, message: "MFA authentication failed" });
  }
});

//create manager/cashier account
router.post(
  "/auth/staff",
  authenticateJWT,
  authorizeRoles("owner"),
  async (req, res) => {
    try {
      const { name, email, password, phone, role } = req.body;

      if (!req.user || !req.user.businessId) {
        return res.status(400).json({
          success: false,
          message: "Authenticated user is not associated with a business",
        });
      }

      const businessId = req.user.businessId;

      if (!name || !email || !password || !phone || !role) {
        return res.status(400).json({
          success: false,
          message: "Name,email,password,phone and role are required",
        });
      }

      //create only manager and cashier in this route
      if (role !== ROLES.MANAGER && role !== ROLES.CASHIER) {
        return res.status(400).json({
          success: false,
          message: "Only manager or cashier accounts can be created",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long",
        });
      }

      const existingUser = await User.findOne({ email: normalizedEmail });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "An account for staff with this email exists",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      //create employee
      const employee = new User({
        businessId,
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        phone: phone.trim(),
        role,
        isActive: true,
      });

      await employee.save();
      return res.status(201).json({
        success: true,
        message: "Employee account created successfully",
        user: {
          id: employee._id,
          name: employee.name,
          email: employee.email,
          phone: employee.phone,
          role: employee.role,
          businessId: employee.businessId,
          isActive: employee.isActive,
        },
      });
    } catch (err) {
      console.error("Create employee account error:", err);

      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  },
);

module.exports = { router };
