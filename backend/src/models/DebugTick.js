"use strict";
var mongoose = require("mongoose");

var DebugTickSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  basisSnapshot: { type: mongoose.Schema.Types.Mixed, default: [] },
  huntRowsSummary: { type: mongoose.Schema.Types.Mixed, default: [] },
  counts: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastError: { type: String, default: null }
});

module.exports = mongoose.model("DebugTick", DebugTickSchema);