require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
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

const { sendPasswordResetEmail } = require("../services/emailService.js");

const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();

const REFRESH_COOKIE_NAME = "refreshToken";

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

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

    return res.status(200).json({
      success: true,
      message:
        "Password verified. MFA verification required. Enter token from Authenticator App.",
      mfaRequired: true,
      challange,
    });
  } catch (error) {
    console.error("Login error:", error);

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

    const user = await User.findById(decoded.userId)
      .select("+mfaSecretEncrypted")
      .populate("businessId", "name");

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

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId._id,
        businessName: user.businessId.name,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res
      .status(500)
      .json({ success: false, message: "MFA authentication failed" });
  }
});

//refresh token route
router.post("/auth/refresh-token", async (req, res) => {
  try {
    const rawRawfreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (!rawRawfreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is missing. Please log in again.",
      });
    }

    const tokenHash = hashRefreshToken(rawRawfreshToken);
    const now = new Date();

    //automatically revoke the token so it cannot be reused concurrently
    const storedToken = await RefreshToken.findOneAndUpdate(
      {
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: { revokedAt: now },
      },
      {
        returnDocument: "after",
      },
    );

    if (!storedToken) {
      res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/auth",
      });

      return res.status(401).json({
        success: false,
        message: "Refresh token is invalid,expired or already used.",
      });
    }

    const user = await User.findById(storedToken.userId);

    if (!user || !user.isActive) {
      res.clearCookie(REFRESH_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/auth",
      });

      return res.status(401).json({
        success: false,
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    const accessToken = createAccessToken(user);

    const newRefreshToken = await createRefreshToken(user);
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    await RefreshToken.updateOne(
      { _id: storedToken._id },
      { $set: { replacedByTokenHash: newRefreshTokenHash } },
    );

    res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, refreshCookieOptions);

    return res.status(200).json({
      success: true,
      message: "Access token refreshed successfully.",
      accessToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to refresh your session.",
    });
  }
});

//password reset route
router.post("/auth/forgot-password", async (req, res) => {
  const genericMessage =
    "If an account for this email, a password reset link will be sent.";

  try {
    const { email } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail, isActive: true });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: genericMessage,
      });
    }

    //generate a secure single use token
    const rawToken = crypto.randomBytes(32).toString("hex");

    //store SHA-256 hash in MongoDB
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const expiryMinutes = 15;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    user.resetPasswordTokenHash = tokenHash;
    user.resetPasswordExpires = expiresAt;

    await user.save();

    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
      throw new Error("FRONTEND_URL is missing from environment variables");
    }

    const resetUrl = new URL("/reset-password", frontendUrl);
    resetUrl.searchParams.set("token", rawToken);

    try {
      await sendPasswordResetEmail(user.email, resetUrl.toString());
    } catch (emailError) {
      // Invalidate the token if delivery fails.
      await user.updateOne(
        { _id: user._id, resetPasswordTokenHash: tokenHash },
        { $unset: { resetPasswordTokenHash: 1, resetPasswordExpires: 1 } },
      );

      throw emailError;
    }

    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(209).json({
      success: true,
      message:
        "If an account exists for that email, a password reset link will be sent.",
    });
  }
});

//reset password
router.post("/auth/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset link",
      });
    }

    if (typeof password !== "string" || typeof confirmPassword !== "string") {
      return res.status(400).json({
        success: false,
        message: "Password and confirmation are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long",
      });
    }

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.findOneAndUpdate(
      {
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpires: { $gt: new Date() },
        isActive: true,
      },
      {
        $set: { password: hashedPassword },
        $unset: {
          resetPasswordTokenHash: 1,
          resetPasswordExpires: 1,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset link",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset successfully. Please log in again.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to reset password at this time",
    });
  }
});

//get the currently authenticated user's profile
router.get("/auth/me", authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    const user = await User.findById(userId)
      .select(
        "name email phone role businessId isActive isMfaEnabled lastLogin",
      )
      .populate("businessId", "name currency timezone isActive");

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is unavailable or inactive.",
      });
    }

    if (user.businessId && user.businessId.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "This business account is inactive.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        business: user.businessId
          ? {
              id: user.businessId._id,
              name: user.businessId.name,
              currency: user.businessId.currency,
              timezone: user.businessId.timezone,
            }
          : null,
        isMfaEnabled: user.isMfaEnabled,
        lastLogin: user.lastLogin,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your profile.",
    });
  }
});

// Log out and revoke the current refresh token
router.post("/auth/logout", async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];

    if (rawRefreshToken) {
      const tokenHash = hashRefreshToken(rawRefreshToken);

      await RefreshToken.findOneAndUpdate(
        {
          tokenHash,
          revokedAt: null,
        },
        {
          $set: { revokedAt: new Date() },
        },
      );
    }

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    // Clear the browser cookie even if the database operation fails.
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
    });

    return res.status(500).json({
      success: false,
      message: "Unable to complete logout on the server.",
    });
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
