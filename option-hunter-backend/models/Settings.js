"use strict";
var mongoose = require("mongoose");

/* هر استراتژی تنظیمات مستقل خودش را دارد: نرخ شوک روزانه، نرخ سود روزانه و
   امکان غیرفعال‌سازی اعلان تلگرام برای همان استراتژی به‌صورت جداگانه.
   کف‌های ثابت (shockFloor/profitFloor) به‌طور کامل حذف شده‌اند. */
var StrategyHuntSchema = new mongoose.Schema({
  shockRate: { type: Number, default: 0.5 },
  profitRate: { type: Number, default: 0.35 },
  telegramEnabled: { type: Boolean, default: true }
}, { _id: false });

/* کانورژن و باکس بازده ثابت دارند (مستقل از قیمت سهم پایه) بنابراین shockRate
   برایشان بی‌معناست؛ مقدار پیش‌فرض صفر می‌ماند ولی در huntEngine.js اصلاً
   بررسی نمی‌شود. */
var HUNT_STRATEGY_DEFAULTS = {
  cc: [0.5, 0.35],
  mp: [0.5, 0.35],
  co: [0.5, 0.35],
  cv: [0, 0.35],
  strangle: [0.5, 0.7],
  strangleSell: [0.5, 0.7],
  callspread: [0.5, 0.7],
  callspreadbear: [0.5, 0.7],
  putspread: [0.5, 0.7],
  putspreadbull: [0.5, 0.7],
  box: [0, 0.7]
};

var HUNT_STRATEGY_TYPES = Object.keys(HUNT_STRATEGY_DEFAULTS);

function defaultHuntStrategies() {
  var obj = {};
  HUNT_STRATEGY_TYPES.forEach(function (key) {
    var d = HUNT_STRATEGY_DEFAULTS[key];
    obj[key] = { shockRate: d[0], profitRate: d[1], telegramEnabled: true };
  });
  return obj;
}

var huntStrategiesFields = HUNT_STRATEGY_TYPES.reduce(function (acc, key) {
  var d = HUNT_STRATEGY_DEFAULTS[key];
  acc[key] = {
    type: StrategyHuntSchema,
    default: function () { return { shockRate: d[0], profitRate: d[1], telegramEnabled: true }; }
  };
  return acc;
}, {});

var HuntStrategiesSchema = new mongoose.Schema(huntStrategiesFields, { _id: false });

var SettingsSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  scenStep: { type: Number, default: 5 },
  dteFilterMin: { type: String, default: "" },
  dteFilterMax: { type: String, default: "" },
  checkIntervalSec: { type: Number, default: 60 },

  huntOnlyBuyable: { type: Boolean, default: true },

  // تعداد ارسال به تلگرام (اگر huntTopNUnlimited فعال باشد، این عدد نادیده گرفته می‌شود)
  huntTopN: { type: Number, default: 30 },
  huntTopNUnlimited: { type: Boolean, default: false },

  // فاصله‌ی یادآوری تلگرام (ساعت + دقیقه)؛ اگر huntCooldownForever فعال باشد
  // هر موقعیت فقط یک‌بار در طول عمر برنامه اعلان داده می‌شود و دیگر تکرار نمی‌شود.
  huntCooldownHours: { type: Number, default: 12 },
  huntCooldownMinutes: { type: Number, default: 0 },
  huntCooldownForever: { type: Boolean, default: false },

  huntStrategies: { type: HuntStrategiesSchema, default: defaultHuntStrategies }
}, { timestamps: true });

var SettingsModel = mongoose.model("Settings", SettingsSchema);
SettingsModel.HUNT_STRATEGY_TYPES = HUNT_STRATEGY_TYPES;
SettingsModel.HUNT_STRATEGY_DEFAULTS = HUNT_STRATEGY_DEFAULTS;

module.exports = SettingsModel;
