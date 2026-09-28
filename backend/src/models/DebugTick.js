"use strict";
var mongoose = require("mongoose");

var DebugTickSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  // ✅ "auto" = ثبت خودکار در هر چرخه، "capture" = ثبت دستی با داده‌ی کامل
  kind: { type: String, enum: ["auto", "capture"], default: "auto", index: true },
  fetchedAt: { type: Date, default: null },
  apiHash: { type: String, default: null },
  apiRowCount: { type: Number, default: 0 },
  apiFetchMs: { type: Number, default: 0 },
  // فقط در kind=capture پر می‌شود
  apiSample: { type: mongoose.Schema.Types.Mixed, default: null },
  parsedContracts: { type: mongoose.Schema.Types.Mixed, default: null },
  cacheContracts: { type: mongoose.Schema.Types.Mixed, default: null },
  diffSummary: { type: mongoose.Schema.Types.Mixed, default: null },
  // در هر دو حالت
  basisSnapshot: { type: mongoose.Schema.Types.Mixed, default: [] },
  huntRowsSummary: { type: mongoose.Schema.Types.Mixed, default: [] },
  counts: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastError: { type: String, default: null }
});

module.exports = mongoose.model("DebugTick", DebugTickSchema);