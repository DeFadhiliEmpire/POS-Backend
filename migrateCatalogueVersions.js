require("dotenv").config();

const mongoose = require("mongoose");
const Product = require("./models/Product.js");
const Category = require("./models/Category.js");

async function migrateCatalogueVersions() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URL is missing");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const productResult = await Product.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } },
  );

  const categoryResult = await Category.updateMany(
    { version: { $exists: false } },
    { $set: { version: 1 } },
  );

  console.log("Product versions migrated:", productResult.modifiedCount);
  console.log("Category versions migrated:", categoryResult.modifiedCount);

  await mongoose.disconnect();
}

migrateCatalogueVersions().catch(console.error);
