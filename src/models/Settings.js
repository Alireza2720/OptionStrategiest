"use strict";
var mongoose = require("mongoose");

var CatSchema = new mongoose.Schema({
  shockRate: { type: Number, default: 0.5 },
  shockFloor: { type: Number, default: 25 },
  profitRate: { type: Number, default: 0.35 },
  profitFloor: { type: Number, default: 10 }
}, { _id: false });

var SettingsSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  scenStep: { type: Number, default: 5 },
  dteFilterMin: { type: String, default: "" },
  dteFilterMax: { type: String, default: "" },
  checkIntervalSec: { type: Number, default: 60 },
  huntOnlyBuyable: { type: Boolean, default: true },
  huntTopN: { type: Number, default: 30 },
  huntCooldownHours: { type: Number, default: 12 },
  lastResetDate: { type: String, default: "" },
  huntCat1: {
    type: CatSchema,
    default: function () { return { shockRate: 0.5, shockFloor: 25, profitRate: 0.35, profitFloor: 10 }; }
  },
  huntCat2: {
    type: CatSchema,
    default: function () { return { shockRate: 0.5, shockFloor: 30, profitRate: 0.7, profitFloor: 25 }; }
  }
}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);
