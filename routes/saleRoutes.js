const express = require("express");

const authenticateJWT = require("../middleware/authenticate.js");
const { processCheckout } = require("../services/checkoutServices.js");

const router = express.Router();

//create and process an online sale
router.post("/sales", authenticateJWT, async (req, res) => {
  try {
    if (!req.user) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    if (!req.user.businessId) {
      return res.status(400).json({
        success: false,
        message: "User is not associated with a business",
      });
    }

    const businessId = req.user.businessId;
    const cashierId = req.user._id;

    const deviceId = req.headers["x-device-id"] || "web";

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: "Device ID is required",
      });
    }

    //process checkout
    const result = await processCheckout({
      businessId,
      cashierId,
      deviceId,
      saleData: req.body,
    });

    return res.status(201).json({
      success: true,
      message: result.message,
      duplicate: result.duplicate,
      sale: result.sale,
      payment: result.payment,
    });
  } catch (error) {
    console.error("Create sale error:", error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    //duplicate key
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This sale has already been processed",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = { router };
