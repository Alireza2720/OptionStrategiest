"use strict";
var mongoose = require("mongoose");

var TargetSchema = new mongoose.Schema({
  kind: { type: String, enum: ["profit", "loss"], required: true },
  value: { type: Number, required: true },
  hit: { type: Boolean, default: false },
  hitAt: { type: Date, default: null },
  notified: { type: Boolean, default: false }
}, { _id: true });

var EntriesSchema = new mongoose.Schema({
  stockEntry: { type: Number, default: null },
  legEntries: { type: [Number], default: [] },
  margin: { type: Number, default: null }
}, { _id: false });

var FollowedSignalSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", index: true },
  signalKey: { type: String, required: true, index: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },

  status: {
    type: String,
    enum: ["active", "closed"],
    default: "active",
    index: true
  },

  entries: { type: EntriesSchema, default: function () { return {}; } },
  entryNote: { type: String, default: "" },

  base: { type: Number, default: null },
  currentPnL: { type: Number, default: null },
  currentROI: { type: Number, default: null },
  peakROI: { type: Number, default: null },
  troughROI: { type: Number, default: null },
  lastUpdated: { type: Date, default: null },

  targets: { type: [TargetSchema], default: [] },

  closedAt: { type: Date, default: null },
  exitNote: { type: String, default: "" },
  finalPnL: { type: Number, default: null },
  finalROI: { type: Number, default: null }
}, { timestamps: true });

FollowedSignalSchema.index({ ownerId: 1, status: 1 });
FollowedSignalSchema.index({ ownerId: 1, signalKey: 1, status: 1 });

module.exports = mongoose.model("FollowedSignal", FollowedSignalSchema);