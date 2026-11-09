const express = require("express");
const mongoose = require("mongoose");

const Category = require("../models/Category");
const Product = require("../models/Product");
const CatalogueSyncCounter = require("../models/CatalogueSyncCounter");
const authenticateJWT = require("../middleware/authenticate.js");

const router = express.Router();

// First-time download of the complete catalogue.
// Includes inactive records so devices receive deactivations too.
router.get("/sync/catalogue/bootstrap", authenticateJWT, async (req, res) => {
  const businessId = req.user.businessId;

  if (!businessId) {
    return res.status(400).json({
      success: false,
      message: "Business information is missing",
    });
  }

  let session;

  try {
    const session = await mongoose.startSession();

    session.startTransaction({ readConcern: { level: "snapshot" } });

    const categories = await Category.find({ businessId })
      .session(session)
      .lean();
    const products = await Product.find({ businessId }).session(session).lean();
    const counter = await CatalogueSyncCounter.findOne({ businessId })
      .session(session)
      .lean();

    snapshot = {
      categories,
      products,
      cursor: counter?.sequence || 0,
    };

    await session.commitTransaction();

    console.log("Catalogue bootstrap successful:", {
      businessId,
      categories: categories.length,
      products: products.length,
      cursor: snapshot.cursor,
    });

    return res.status(200).json({
      success: true,
      message: "Catalogue bootstrap completed",
      snapshot,
    });
  } catch (error) {
    if (session?.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Transaction abort failed:", abortError);
      }
    }

    console.error("Catalogue bootstrap error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to download catalogue",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

module.exports = { router };
