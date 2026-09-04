"use strict";
var mongoose = require("mongoose");

var CacheSnapshotSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  updatedAt: { type: Date, default: Date.now },
  watch: { type: mongoose.Schema.Types.Mixed, default: [] },
  strategies: { type: mongoose.Schema.Types.Mixed, default: {} },
  steps: { type: mongoose.Schema.Types.Mixed, default: [] },
  huntLatest: { type: mongoose.Schema.Types.Mixed, default: { at: null, rows: [] } }
});

module.exports = mongoose.model("CacheSnapshot", CacheSnapshotSchema);