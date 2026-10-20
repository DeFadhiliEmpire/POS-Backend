const mongoose = require("mongoose");

const Sale = require("../models/Sale.js");
const Product = require("../models/Product.js");
const Payment = require("../models/Payment.js");
const StockMovement = require("../models/StockMovement.js");

const processOfflineSale = async ({
  businessId,
  cashierId,
  deviceId,
  saleData,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      clientSaleId,
      receiptNumber,
      customerId,
      items,
      subtotal,
      discount,
      tax,
      payment,
      soldAt,
    } = saleData;

    //validate basic sale information
    if (!clientSaleId) {
      throw new Error("clientSaleId is required");
    }
    if (!deviceId) {
      throw new Error("deviceId is required");
    }

    if (!receiptNumber) {
      throw new Error("receiptNumber is required ");
    }
    if (!payment) {
      throw new Error("Payment information is required");
    }

    //prevent duplicate sync
    const existingSale = await Sale.findOne({
      businessId,
      clientSaleId,
    }).session(session);

    if (existingSale) {
      await session.commitTransaction();
      return {
        status: "already synched",
        serverSaleId: existingSale._id,
        receiptNumber: existingSale.receiptNumber,
      };
    }

    //validate payment
    if (payment.amount !== total) {
      throw new Error("Payment amount mmust be equal sale total");
    }

    //validating items
    if (!items || items.length === 0) {
      throw new Error("Sale must contain at least one item");
    }

    //fetch products
    const productIds = items.map((item) => item.productId);
    const products = await Product.find({
      _id: { $in: productIds },
      businessId,
      isActive: true,
    }).session(session);

    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    //validate stock
    for (const item of items) {
      const product = productMap.get(item.productId.toString());
      if (!product) {
        throw new Error(`Product ${item.productId} not found`);
      }
      if (product.stockQuantity < item.quantity) {
        const err = new Error(`Insufficient stock for ${product.name}`);
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
    }

    //Create sale items
    const saleItems = [];
    for (const item of items) {
      const product = productMap.get(item.productId.toString());

      saleItems.push({
        product: product._id,
        productName: product.name,
        sku: product.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        buyingPrice: product.buyingPrice,
        subtotal: item.subtotal,
      });
    }

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
      discount: discount || 0,
      tax: tax || 0,
      total,
      syncStatus: "synched",
      status: "completed",
      soldAt,
    });

    await sale.save({ session });

    //process stock
    for (const item of items) {
      const updatedProduct = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          businessId,
          isActive: true,
          stockQuantity: { $gte: item.quantity },
        },
        {
          $inc: { stockQuantity: -item.quantity },
        },
        {
          new: true,
          session,
        },
      );

      if (!updatedProduct) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }

      //create sock movement
      await StockMovement.create(
        [
          {
            businessId,
            product: updatedProduct._id,
            type: "sale",
            quantity: item.quantity,
            direction: "out",
            referenceType: "sale",
            referenceId: sale._id,
            performedBy: cashierId,
            deviceId,
            clientMovementId: `${clientSaleId}-${updatedProduct._id}`,
            occurredAt,
          },
        ],
        {
          session,
        },
      );
    }

    //Create payment

    await Payment.create(
      [
        {
          businessId,
          sale: sale._id,
          amount: payment.amount,
          method: payment.method,
          status: "completed",
          transactionReference: payment.transactionReference || undefined,
          phoneNumber: payment.phoneNumber || undefined,
          paidAt: occurredAt,
        },
      ],
      {
        session,
      },
    );

    //commit everything
    await session.commitTransaction();
    return {
      status: "synched",
      serverSaleId: sale._id,
      receiptNumber: sale.receiptNumber,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
};

module.exports = processOfflineSale;
