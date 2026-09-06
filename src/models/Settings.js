"use strict";
var mongoose = require("mongoose");

var HUNT_STRATEGY_TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

var HuntStrategyCfgSchema = new mongoose.Schema({
  shockRate: { type: Number, default: 0.5 },
  shockMode: { type: String, enum: ["rate", "floor", "both"], default: "rate" },
  shockFloor: { type: Number, default: 5 },
  profitRate: { type: Number, default: 0.35 },
  profitMode: { type: String, enum: ["rate", "floor", "both"], default: "rate" },
  profitFloor: { type: Number, default: 5 },
  telegramEnabled: { type: Boolean, default: true }
}, { _id: false });

function defaultHuntStrategyCfg() {
  return {
    shockRate: 0.5, shockMode: "rate", shockFloor: 5,
    profitRate: 0.35, profitMode: "rate", profitFloor: 5,
    telegramEnabled: true
  };
}

function defaultHuntStrategies() {
  var obj = {};
  HUNT_STRATEGY_TYPES.forEach(function (t) {
    obj[t] = defaultHuntStrategyCfg();
  });
  return obj;
}

var HuntStrategiesSchema = new mongoose.Schema(
  HUNT_STRATEGY_TYPES.reduce(function (acc, t) {
    acc[t] = { type: HuntStrategyCfgSchema, default: defaultHuntStrategyCfg };
    return acc;
  }, {}),
  { _id: false }
);

var SettingsSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  scenStep: { type: Number, default: 5 },
  dteFilterMin: { type: String, default: "" },
  dteFilterMax: { type: String, default: "" },
  checkIntervalSec: { type: Number, default: 60 },

  huntOnlyBuyable: { type: Boolean, default: true },
  huntTopN: { type: Number, default: 30 },
  huntTopNUnlimited: { type: Boolean, default: false },
  huntCooldownMinutes: { type: Number, default: 720 },
  huntCooldownForever: { type: Boolean, default: false },

  huntStrategies: {
    type: HuntStrategiesSchema,
    default: defaultHuntStrategies
  },

  // تاریخ‌های تعطیلی دستی (فرمت "YYYY-MM-DD" بر اساس تقویم میلادی، به وقت تهران)
  manualHolidays: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);
module.exports.HUNT_STRATEGY_TYPES = HUNT_STRATEGY_TYPES;
