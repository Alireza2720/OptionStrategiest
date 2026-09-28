"use strict";
var mongoose = require("mongoose");

var ApiWatchSampleSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  hash: { type: String, default: null },
  rowCount: { type: Number, default: 0 },
  fetchMs: { type: Number, default: 0 },
  isMarketOpen: { type: Boolean, default: false },
  changedSincePrev: { type: Boolean, default: false },
  error: { type: String, default: null },
  sampleData: { type: mongoose.Schema.Types.Mixed, default: null }
});

// خودکار بعد از 30 روز پاک شود
ApiWatchSampleSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
ApiWatchSampleSchema.index({ isMarketOpen: 1, changedSincePrev: 1, at: 1 });

module.exports = mongoose.model("ApiWatchSample", ApiWatchSampleSchema);