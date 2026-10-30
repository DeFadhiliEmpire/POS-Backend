const express = require("express");
const mongoose = require("mongoose");

const Product = require("../models/Product.js");
const Category = require("../models/Category.js");
const CatalogueSyncEvent = require("../models/CatalogueSyncEvent.js");
const CatalogueSyncCounter = require("../models/CatalogueSyncCounter.js");

const authenticateJWT = require("../middleware/authenticate.js");
const authorizeRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();

const MAX_OPERATIONS = 50;
const MAX_DOWNLOADS = 500;

const allowedProductFields = [
  "name",
  "sku",
  "barcode",
  "category",
  "buyingPrice",
  "sellingPrice",
  "lowStockThreshold",
  "unit",
  "imageUrl",
];

const allowedCategoryFields = ["name", "description"];

class SyncError extends Error {
  constructor(message, status = "failed") {
    super(message);
    this.status = status;
  }
}

function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function pickFields(source, allowedFields) {
  const result = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(source || {}, field)) {
      result[field] = source[field];
    }
  }

  return result;
}

function validateProductPayload(payload) {
  if (!payload.name?.trim() || !payload.sku?.trim() || !payload.category) {
    throw new SyncError("Product name, SKU and category are required");
  }

  if (
    !Number.isFinite(payload.buyingPrice) ||
    payload.buyingPrice < 0 ||
    !Number.isFinite(payload.sellingPrice) ||
    payload.sellingPrice < 0
  ) {
    throw new SyncError(
      "Valid non-negative buying and selling prices are required",
    );
  }

  if (
    payload.lowStockThreshold !== undefined &&
    (!Number.isFinite(payload.lowStockThreshold) ||
      payload.lowStockThreshold < 0)
  ) {
    throw new SyncError("Invalid low-stock threshold");
  }
}

async function nextSequence(businessId, session) {
  const counter = await CatalogueSyncCounter.findOneAndUpdate(
    { businessId },
    { $inc: { sequence: 1 }, $setOnInsert: { businessId } },
    { new: true, upsert: true, session },
  );

  return counter.sequence;
}

async function applyOperation(operation, context) {
  const { businessId, userId, deviceId, session } = context;

  const { operationId, entityType, entityId, action, baseVersion } = operation;

  if (
    !operationId ||
    typeof operationId !== "string" ||
    operationId.length > 128
  ) {
    throw new SyncError("A valid operationId is required");
  }

  if (!["product", "category"].includes(entityType)) {
    throw new SyncError("Unsupported entity type");
  }

  if (!["create", "update", "deactivate"].includes(action)) {
    throw new SyncError("Unsupported catalogue action");
  }

  if (!validObjectId(entityId)) {
    throw new SyncError("A valid entityId is required");
  }

  // Idempotency: an operation already committed is never applied again.
  const previousEvent = await CatalogueSyncEvent.findOne({
    businessId,
    operationId,
  }).session(session);

  if (previousEvent) {
    return {
      operationId,
      status: "already_synced",
      serverVersion: previousEvent.entityVersion,
      sequence: previousEvent.sequence,
    };
  }

  const id = new mongoose.Types.ObjectId(entityId);
  let entity;
  let snapshot;

  if (entityType === "category") {
    if (action === "create") {
      const payload = pickFields(operation.payload, allowedCategoryFields);

      if (!payload.name?.trim()) {
        throw new SyncError("Category name is required");
      }

      if (baseVersion !== 0) {
        throw new SyncError("New categories must use baseVersion 0");
      }

      entity = new Category({
        _id: id,
        businessId,
        name: payload.name.trim(),
        description: payload.description,
        isActive: true,
        version: 1,
      });

      await entity.save({ session });
    } else {
      if (!Number.isInteger(baseVersion) || baseVersion < 1) {
        throw new SyncError("A valid baseVersion is required");
      }

      const current = await Category.findOne({
        _id: id,
        businessId,
      }).session(session);

      if (!current) {
        throw new SyncError("Category not found");
      }

      if (current.version !== baseVersion || !current.isActive) {
        throw new SyncError(
          `Category version conflict. Current server version is ${current.version}`,
          "conflict",
        );
      }

      if (action === "update") {
        const payload = pickFields(operation.payload, allowedCategoryFields);

        if (!payload.name?.trim()) {
          throw new SyncError("Category name is required");
        }

        current.name = payload.name.trim();

        if (payload.description !== undefined) {
          current.description = payload.description;
        }
      }

      if (action === "deactivate") {
        const activeProducts = await Product.countDocuments({
          businessId,
          category: id,
          isActive: true,
        }).session(session);

        if (activeProducts > 0) {
          throw new SyncError(
            "Move active products to another category before deactivating this category",
            "conflict",
          );
        }

        current.isActive = false;
      }

      current.version += 1;
      await current.save({ session });
      entity = current;
    }

    snapshot = entity.toObject();
  }

  if (entityType === "product") {
    if (action === "create") {
      const payload = pickFields(operation.payload, allowedProductFields);

      validateProductPayload(payload);

      if (baseVersion !== 0) {
        throw new SyncError("New products must use baseVersion 0");
      }

      const category = await Category.findOne({
        _id: payload.category,
        businessId,
        isActive: true,
      }).session(session);

      if (!category) {
        throw new SyncError(
          "Product category is missing, inactive or not synchronized yet",
          "conflict",
        );
      }

      entity = new Product({
        _id: id,
        businessId,
        ...payload,
        name: payload.name.trim(),
        sku: payload.sku.trim().toUpperCase(),
        category: category._id,
        stockQuantity: 0,
        isActive: true,
        version: 1,
      });

      await entity.save({ session });
    } else {
      if (!Number.isInteger(baseVersion) || baseVersion < 1) {
        throw new SyncError("A valid baseVersion is required");
      }

      const current = await Product.findOne({
        _id: id,
        businessId,
      }).session(session);

      if (!current) {
        throw new SyncError("Product not found");
      }

      if (current.version !== baseVersion || !current.isActive) {
        throw new SyncError(
          `Product version conflict. Current server version is ${current.version}`,
          "conflict",
        );
      }

      if (action === "update") {
        const payload = pickFields(operation.payload, allowedProductFields);

        validateProductPayload({
          name: payload.name ?? current.name,
          sku: payload.sku ?? current.sku,
          category: payload.category ?? current.category.toString(),
          buyingPrice: payload.buyingPrice ?? current.buyingPrice,
          sellingPrice: payload.sellingPrice ?? current.sellingPrice,
          lowStockThreshold:
            payload.lowStockThreshold ?? current.lowStockThreshold,
        });

        const category = await Category.findOne({
          _id: payload.category ?? current.category,
          businessId,
          isActive: true,
        }).session(session);

        if (!category) {
          throw new SyncError(
            "Product category is missing, inactive or belongs to another business",
            "conflict",
          );
        }

        for (const [field, value] of Object.entries(payload)) {
          if (field === "name") current.name = value.trim();
          else if (field === "sku") current.sku = value.trim().toUpperCase();
          else if (field === "category") current.category = category._id;
          else current[field] = value;
        }
      }

      if (action === "deactivate") {
        current.isActive = false;
      }

      current.version += 1;
      await current.save({ session });
      entity = current;
    }

    snapshot = entity.toObject();
  }

  const sequence = await nextSequence(businessId, session);

  await CatalogueSyncEvent.create(
    [
      {
        businessId,
        operationId,
        deviceId,
        performedBy: userId,
        entityType,
        entityId: id,
        action,
        entityVersion: entity.version,
        sequence,
        snapshot,
      },
    ],
    { session },
  );

  return {
    operationId,
    status: "synced",
    serverVersion: entity.version,
    sequence,
  };
}

// POST /sync/catalogue
router.post("/sync/catalogue", authenticateJWT, async (req, res) => {
  const businessId = req.user.businessId;
  const userId = req.user._id;
  const deviceId = req.headers["x-device-id"] || req.body.deviceId;

  if (!businessId || !userId) {
    return res.status(401).json({
      success: false,
      message: "Authenticated business user required",
    });
  }

  if (!deviceId || typeof deviceId !== "string" || deviceId.length > 128) {
    return res.status(400).json({
      success: false,
      message: "A valid deviceId is required",
    });
  }

  const operations = req.body.operations ?? [];
  const lastSyncCursor = req.body.lastSyncCursor ?? 0;

  const role = String(req.user.role || "").toUpperCase();

  const canManageCatalogue = ["owner", "manager"].includes(role);

  // Cashiers can download changes but cannot upload catalogue operations.
  if (operations.length > 0 && !canManageCatalogue) {
    return res.status(403).json({
      success: false,
      message: "You are not allowed to modify the catalogue",
    });
  }

  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) {
    return res.status(400).json({
      success: false,
      message: `Send an operations array containing at most ${MAX_OPERATIONS} operations`,
    });
  }

  if (!Number.isSafeInteger(lastSyncCursor) || lastSyncCursor < 0) {
    return res.status(400).json({
      success: false,
      message: "lastSyncCursor must be a non-negative integer",
    });
  }

  const results = [];

  for (const operation of operations) {
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const result = await applyOperation(operation, {
        businessId,
        userId,
        deviceId,
        session,
      });

      await session.commitTransaction();
      results.push(result);
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      console.error("Catalogue operation failed:", err);

      if (err.code === 11000) {
        results.push({
          operationId: operation?.operationId,
          status: "conflict",
          message: "A duplicate SKU, category name or operation was detected",
        });
      } else {
        results.push({
          operationId: operation?.operationId,
          status: err.status || "failed",
          message: err.message || "Catalogue operation failed",
        });
      }
    } finally {
      await session.endSession();
    }
  }

  try {
    const events = await CatalogueSyncEvent.find({
      businessId,
      sequence: { $gt: lastSyncCursor },
    })
      .sort({ sequence: 1 })
      .limit(MAX_DOWNLOADS)
      .lean();

    const counter = await CatalogueSyncCounter.findOne({ businessId }).lean();
    const latestSequence = counter?.sequence || 0;

    const nextSyncCursor = events.length
      ? events[events.length - 1].sequence
      : lastSyncCursor;

    return res.status(200).json({
      success: true,
      message: "Catalogue synchronization completed",
      results,
      changes: {
        products: events
          .filter((event) => event.entityType === "product")
          .map((event) => ({
            ...event.snapshot,
            syncSequence: event.sequence,
          })),
        categories: events
          .filter((event) => event.entityType === "category")
          .map((event) => ({
            ...event.snapshot,
            syncSequence: event.sequence,
          })),
      },
      nextSyncCursor,
      latestSequence,
      hasMore: nextSyncCursor < latestSequence,
    });
  } catch (err) {
    console.error("Catalogue download error:", err);

    return res.status(500).json({
      success: false,
      message: "Catalogue changes could not be downloaded",
      results,
    });
  }
});

module.exports = { router };
