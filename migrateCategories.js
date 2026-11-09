require("dotenv").config();
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Category = require("./models/Category.js");

async function migrateCategories() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URL is missing");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const categories = await Category.collection.find({}).toArray();

    for (const category of categories) {
      const normalizedName = category.name
        .trim()
        .normalize("NFKC")
        .toLowerCase();

      await Category.collection.updateOne(
        { _id: category._id },
        {
          $set: {
            categoryUid: category.categoryUid || randomUUID(),
            normalizedName,
            version: category.version || 1,
          },
        },
      );
    }

    // Remove the old case-sensitive unique index.
    const indexes = await Category.collection.indexes();

    const oldIndex = indexes.find(
      (index) =>
        index.name !== "_id_" &&
        JSON.stringify(index.key) ===
          JSON.stringify({ businessId: 1, name: 1 }),
    );

    if (oldIndex) {
      await Category.collection.dropIndex(oldIndex.name);
    }

    // Build the new indexes.
    await Category.collection.createIndex(
      { businessId: 1, categoryUid: 1 },
      { unique: true },
    );

    await Category.collection.createIndex(
      { businessId: 1, normalizedName: 1 },
      { unique: true },
    );

    console.log("Category migration completed:", categories.length);
  } catch (error) {
    console.error("Category migration failed:", error);
  } finally {
    await mongoose.disconnect();
  }
}

migrateCategories();
