"use strict";
var mongoose = require("mongoose");

var HUNT_STRATEGY_TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

var HuntStrategyCfgSchema = new mongoose.Schema({
  shockRate: { type: Number, default: 0.5 },
  profitRate: { type: Number, default: 0.35 },
  telegramEnabled: { type: Boolean, default: true }
}, { _id: false });

function defaultHuntStrategies() {
  var obj = {};
  HUNT_STRATEGY_TYPES.forEach(function (t) {
    obj[t] = { shockRate: 0.5, profitRate: 0.35, telegramEnabled: true };
  });
  return obj;
}

var HuntStrategiesSchema = new mongoose.Schema(
  HUNT_STRATEGY_TYPES.reduce(function (acc, t) {
    acc[t] = { type: HuntStrategyCfgSchema, default: function () { return { shockRate: 0.5, profitRate: 0.35, telegramEnabled: true }; } };
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
  }
}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);
module.exports.HUNT_STRATEGY_TYPES = HUNT_STRATEGY_TYPES;
