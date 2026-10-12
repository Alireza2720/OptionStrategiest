"use strict";
var mongoose = require("mongoose");

var LegSchema = new mongoose.Schema({
    kind: { type: String, enum: ["stock", "call", "put"], required: true },
    contractName: { type: String, required: true },
    expiry: { type: String, default: null },
    strike: { type: Number, default: null },
    side: { type: String, enum: ["buy", "sell"], default: "buy" },
    quantity: { type: Number, default: 1, min: 1 },
    size: { type: Number, default: 1000 },
    entryPrice: { type: Number, required: true },
    margin: { type: Number, default: 0 }
}, { _id: true });

var TargetSchema = new mongoose.Schema({
    kind: { type: String, enum: ["profit", "loss"], required: true },
    value: { type: Number, required: true },
    hit: { type: Boolean, default: false },
    hitAt: { type: Date, default: null },
    notified: { type: Boolean, default: false }
}, { _id: true });

var ManualTrackerSchema = new mongoose.Schema({
    ownerId: { type: String, default: "default", index: true },
    title: { type: String, default: "پیگیری دستی" },
    note: { type: String, default: "" },
    legs: { type: [LegSchema], default: [] },
    margin: { type: Number, default: 0 },
    targets: { type: [TargetSchema], default: [] },
    trackingEnabled: { type: Boolean, default: true },
    status: { type: String, enum: ["active", "closed"], default: "active", index: true },
    currentPnL: { type: Number, default: null },
    currentROI: { type: Number, default: null },
    base: { type: Number, default: null },
    peakROI: { type: Number, default: null },
    troughROI: { type: Number, default: null },
    lastUpdated: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    exitNote: { type: String, default: "" },
    finalPnL: { type: Number, default: null },
    finalROI: { type: Number, default: null }
}, { timestamps: true });

ManualTrackerSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("ManualTracker", ManualTrackerSchema);
