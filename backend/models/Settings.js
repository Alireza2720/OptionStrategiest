"use strict";
var mongoose = require("mongoose");

/* دسته‌های نرخ شوک/سود شکار موقعیت — کف‌های ثابت قبلی (shockFloor/profitFloor) حذف شدند */
var CatSchema = new mongoose.Schema({
  shockRate: { type: Number, default: 0.5 },
  profitRate: { type: Number, default: 0.35 }
}, { _id: false });

/* فعال/غیرفعال بودن اطلاع‌رسانی تلگرام برای هر استراتژی به‌طور مستقل */
var HuntNotifyEnabledSchema = new mongoose.Schema({
  cc: { type: Boolean, default: true },
  mp: { type: Boolean, default: true },
  co: { type: Boolean, default: true },
  cv: { type: Boolean, default: true },
  strangle: { type: Boolean, default: true },
  strangleSell: { type: Boolean, default: true },
  callspread: { type: Boolean, default: true },
  callspreadbear: { type: Boolean, default: true },
  putspread: { type: Boolean, default: true },
  putspreadbull: { type: Boolean, default: true },
  box: { type: Boolean, default: true }
}, { _id: false });

var SettingsSchema = new mongoose.Schema({
  ownerId: { type: String, default: "default", unique: true, index: true },
  scenStep: { type: Number, default: 5 },
  dteFilterMin: { type: String, default: "" },
  dteFilterMax: { type: String, default: "" },
  checkIntervalSec: { type: Number, default: 60 },
  huntOnlyBuyable: { type: Boolean, default: true },

  huntTopN: { type: Number, default: 30 },
  huntTopNUnlimited: { type: Boolean, default: false },

  huntCooldownHours: { type: Number, default: 12 },
  huntCooldownForever: { type: Boolean, default: false },

  huntNotifyEnabled: {
    type: HuntNotifyEnabledSchema,
    default: function () {
      return {
        cc: true, mp: true, co: true, cv: true,
        strangle: true, strangleSell: true,
        callspread: true, callspreadbear: true,
        putspread: true, putspreadbull: true,
        box: true
      };
    }
  },

  huntCat1: {
    type: CatSchema,
    default: function () { return { shockRate: 0.5, profitRate: 0.35 }; }
  },
  huntCat2: {
    type: CatSchema,
    default: function () { return { shockRate: 0.5, profitRate: 0.7 }; }
  }
}, { timestamps: true });

module.exports = mongoose.model("Settings", SettingsSchema);
