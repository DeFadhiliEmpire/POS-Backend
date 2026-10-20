const mongoose = require("mongoose");

const Product = require("../models/Product.js");
const Sale = require("../models/Sale.js");
const Payment = require("../models/Payment.js");
const StockMovement = require("../models/StockMovement.js");
const Customer = require("../models/Customer.js");

const processCheckout = async ({
  businessId,
  cashierId,
  deviceId,
  saleData,
}) => {
  const session = await mongoose.startSession();

  try {
    const {
      clientSaleId,
      receiptNumber,
      items,
      payment,
      customerId,
      occurredAt,
    } = saleData;

    if (!businessId) {
      throw new Error("Business ID is required");
    }

    if (!cashierId) {
      const error = new Error("Cashier ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!deviceId) {
      const error = new Error("Device ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!clientSaleId) {
      const error = new Error("Client sale ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!receiptNumber) {
      const error = new Error("Receipt number is required");
      error.statusCode = 400;
      throw error;
    }

    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error("At least one sale item is required");
      error.statusCode = 400;
      throw error;
    }

    if (!payment || !payment.method) {
      const error = new Error("Payment information is required");
      error.statusCode = 400;
      throw error;
    }

    //checking for duplicate sale
    const existingSale = await Sale.findOne({ businessId, clientSaleId });

    if (existingSale) {
      return {
        success: true,
        duplicate: true,
        sale: existingSale,
        payment: null,
        message: "Sale has already been processed",
      };
    }

    //validate payment methods
    const allowedPaymentMethods = ["cash", "mpesa", "card", "bank", "credit"];

    if (!allowedPaymentMethods.includes(payment.method)) {
      const error = new Error("Invalid payment method");
      error.statusCode = 400;
      throw error;
    }

    //validate product ids.. prevent duplicate product lines
    const uniqueProductIds = new Set();

    for (const item of items) {
      if (!item.productId) {
        const error = new Error("Product ID is required");
        error.statusCode = 400;
        throw error;
      }

      if (!mongoose.isValidObjectId(item.productId)) {
        const error = new Error(`Invalid product ID: ${item.productId}`);

        error.statusCode = 400;
        throw error;
      }

      if (uniqueProductIds.has(item.productId.toString())) {
        const error = new Error(
          "A product cannot appear more than once in a sale",
        );

        error.statusCode = 400;
        throw error;
      }

      uniqueProductIds.add(item.productId.toString());
    }

    //validate customer
    if (customerId) {
      if (!mongoose.isValidObjectId(customerId)) {
        const error = new Error("Invalid customer ID");
        error.statusCode = 400;
        throw error;
      }

      const customer = await Customer.findOne({
        _id: customerId,
        businessId,
        isActive: true,
      });

      if (!customer) {
        const error = new Error("Customer not found for this business");

        error.statusCode = 404;
        throw error;
      }
    }

    //start Transaction
    session.startTransaction();

    const productIds = Array.from(uniqueProductIds);

    const products = await Product.find({
      _id: { $in: productIds },
      businessId,
      isActive: true,
    }).session(session);

    if (products.length !== productIds.length) {
      const error = new Error(
        "One or more products were not found or are unavailable for this business",
      );
      error.statusCode = 404;
      throw error;
    }

    //build sale items
    const saleItems = [];

    let subtotal = 0;

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        const error = new Error("Product quantity must be greater than zero");

        error.statusCode = 400;
        throw error;
      }

      const product = products.find(
        (product) => product._id.toString() === item.productId.toString(),
      );

      if (!product) {
        const error = new Error("Product not found");
        error.statusCode = 404;
        throw error;
      }

      const unitPrice = product.sellingPrice;

      const itemSubtotal = unitPrice * item.quantity;

      subtotal += itemSubtotal;

      saleItems.push({
        product: product._id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice,
        buyingPrice: product.buyingPrice,
        subtotal: itemSubtotal,
      });
    }

    //calculate Total
    const discount = Number(saleData.discount || 0);
    const tax = Number(saleData.tax || 0);

    if (discount < 0 || tax < 0) {
      const error = new Error("Discount and tax cannot be negative");

      error.statusCode = 400;
      throw error;
    }

    if (discount > subtotal) {
      const error = new Error("Discount cannot be greater than subtotal");

      error.statusCode = 400;
      throw error;
    }

    const total = subtotal - discount + tax;

    //validate payment amount
    const paymentAmount = Number(payment.amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
      const error = new Error("Invalid payment amount");
      error.statusCode = 400;
      throw error;
    }

    if (paymentAmount !== total) {
      const error = new Error(
        `Payment amount must equal sale total of ${total}`,
      );

      error.statusCode = 400;
      throw error;
    }

    const occuredAtValue = occurredAt ? new Date(occurredAt) : new Date();

    //create sale
    const sale = new Sale({
      businessId,
      receiptNumber,
      cashier: cashierId,
      customer: customerId || null,
      deviceId,
      clientSaleId,
      items: saleItems,
      subtotal,
      discount,
      tax,
      total,
      syncStatus: "synced",
      status: "completed",
      occurredAt: occuredAtValue,
    });

    await sale.save({ session });

    //deduct stock atomically
    for (const item of saleItems) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.product,
          businessId,
          isActive: true,
          // Prevent negative stock
          stockQuantity: {
            $gte: item.quantity,
          },
        },
        {
          $inc: {
            stockQuantity: -item.quantity,
          },
        },
        {
          returnDocument: "after",
          session,
        },
      );

      if (!updatedProduct) {
        const error = new Error(
          `Insufficient stock for product ${item.productName}`,
        );

        error.statusCode = 409;
        throw error;
      }
      //create stock movement
      const stockMovement = new StockMovement({
        businessId,
        product: item.product,
        type: "sale",
        quantity: item.quantity,
        direction: "out",
        referenceType: "sale",
        referenceId: sale._id,
        performedBy: cashierId,
        deviceId,
        clientMovementId: `${clientSaleId}-${item.product}`,
        occurredAt: occuredAtValue,
      });

      await stockMovement.save({ session });
    }

    //create payment
    const paymentRecord = new Payment({
      businessId,
      sale: sale._id,
      amount: paymentAmount,
      method: payment.method,
      status: "completed",
      transactionReference:
        payment.transactionReference ||
        (payment.method === "cash"
          ? `CASH-${Date.now()}-${sale._id}`
          : undefined),
      paidAt: new Date(),
    });

    await paymentRecord.save({ session });

    await session.commitTransaction();
    return {
      success: true,
      duplicate: false,
      sale,
      payment: paymentRecord,
      message: "Checkout completed successfully",
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Checkout error:", error);

    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = { processCheckout };
