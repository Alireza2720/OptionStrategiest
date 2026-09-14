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
  // بازهٔ روز تا سررسید مخصوص همین استراتژی؛ اگر خالی باشد از فیلتر عمومی استفاده می‌شود
  dteMin: { type: String, default: "" },
  dteMax: { type: String, default: "" },
  telegramEnabled: { type: Boolean, default: true },
  telegramExitEnabled: { type: Boolean, default: true },
  // فقط برای «استرادل خرید» (وقتی در نوع strangle، قیمت اعمال کال و پوت برابر باشد) استفاده می‌شود
  straddleMinPnl: { type: Number, default: -10 },
  straddleReqShockDown: { type: Number, default: 5 },
  straddleReqShockUp: { type: Number, default: 5 }
}, { _id: false });

function defaultHuntStrategyCfg() {
  return {
    shockRate: 0.5, shockMode: "rate", shockFloor: 5,
    profitRate: 0.35, profitMode: "rate", profitFloor: 5,
    dteMin: "", dteMax: "",
    telegramEnabled: true,
    telegramExitEnabled: true,
    straddleMinPnl: -10, straddleReqShockDown: 5, straddleReqShockUp: 5
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
