const express = require("express");
const authenticateJWT = require("../middleware/authenticate.js");
const { processCheckout } = require("../services/checkoutServices.js");
const Sale = require("../models/Sale");

const router = express.Router();

router.post("/sync/sales", authenticateJWT, async (req, res) => {
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

    const { sales } = req.body;

    const deviceId = req.headers["x-device-id"] || "web";

    if (!deviceId) {
      return res
        .status(400)
        .json({ success: false, message: "Device ID is required" });
    }

    if (!Array.isArray(sales)) {
      return res.status(400).json({
        success: false,
        message: "Sales must be provided as an array",
      });
    }
    if (sales.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "There are no sales to synchronize" });
    }

    const results = [];

    //process each sale
    for (const sale of sales) {
      try {
        //basic client sale id check

        if (!sale.clientSaleId) {
          results.push({
            clientSaleId: null,
            status: "failed",
            statusCode: 400,
            message: "clientSaleId is required",
          });

          continue;
        }

        //Idempotency check
        const existingSale = await Sale.findOne({
          businessId,
          clientSaleId: sale.clientSaleId,
        });

        if (existingSale) {
          results.push({
            clientSaleId: sale.clientSaleId,
            status: "already_synced",
            statusCode: 200,
            message: "Sale has already been synchronized",
            saleId: existingSale._id,
            receiptNumber: existingSale.receiptNumber,
          });

          continue;
        }

        //process Sale
        const result = await processCheckout({
          businessId,
          cashierId,
          deviceId,
          saleData: sale,
        });

        //success
        results.push({
          clientSaleId: sale.clientSaleId,
          status: result.duplicate ? "already_synced" : "synced",
          statusCode: 200,
          message: result.message,
          saleId: result.sale._id,
          receiptNumber: result.sale.receiptNumber,
        });
      } catch (error) {
        console.error(
          `Failed to synchronize sale ${sale.clientSaleId}:`,
          error,
        );

        results.push({
          clientSaleId: sale.clientSaleId,
          status: error.statusCode === 409 ? "conflict" : "failed",
          statusCode: error.statusCode || 500,
          message: error.message || "Failed to synchronize sale",
        });
      }
    }

    //return batch result
    const summary = {
      total: results.length,
      synced: results.filter((r) => r.status === "synced").length,
      alreadySynced: results.filter((r) => r.status === "already_synced")
        .length,
      conflict: results.filter((r) => r.status === "conflict").length,
      failed: results.filter((r) => r.status === "failed").length,
    };

    return res.status(200).json({
      success: true,
      message: "Sales synchronization completed",
      summary,
      results,
    });
  } catch (err) {
    console.error("Sales synchronization error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

module.exports = { router };
