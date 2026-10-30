const mongoose = require("mongoose");

const catalogueSyncCounterSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Business",
    required: true,
    unique: true,
  },

  sequence: {
    type: Number,
    default: 0,
    min: 0,
  },
});

const CatalogueSyncCounter = mongoose.model(
  "CatalogueSyncCounter",
  catalogueSyncCounterSchema,
);

module.exports = CatalogueSyncCounter;
