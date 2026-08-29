"use strict";

var CAT1_TYPES = { cc: true, mp: true, co: true, cv: true };

function pickCfg(source, defaults) {
  source = source || {};
  function num(v, d) {
    var x = parseFloat(v);
    return isNaN(x) ? d : x;
  }
  return {
    shockRate: num(source.shockRate, defaults.shockRate),
    shockFloor: num(source.shockFloor, defaults.shockFloor),
    profitRate: num(source.profitRate, defaults.profitRate),
    profitFloor: num(source.profitFloor, defaults.profitFloor)
  };
}

var DEFAULTS = {
  cat1: { shockRate: 0.5, shockFloor: 25, profitRate: 0.35, profitFloor: 10 },
  cat2: { shockRate: 0.5, shockFloor: 30, profitRate: 0.7, profitFloor: 25 }
};

function cfgFor(type, settings) {
  var key = CAT1_TYPES[type] ? "cat1" : "cat2";
  return pickCfg(settings[key === "cat1" ? "huntCat1" : "huntCat2"], DEFAULTS[key]);
}

function nameFor(type, row) {
  if (type === "cc" || type === "mp") return row.name;
  if (type === "co" || type === "cv" || type === "strangle" || type === "strangleSell") {
    return row.call_name + " / " + row.put_name;
  }
  if (type === "callspread" || type === "callspreadbear" || type === "putspread" || type === "putspreadbull") {
    return row.buy_name + " / " + row.sell_name;
  }
  if (type === "box") {
    return row.call_buy_name + "/" + row.call_sell_name + "/" + row.put_buy_name + "/" + row.put_sell_name;
  }
  return row.name || "";
}

// توجه: این تابع دیگر فیلتر "قابل‌خرید" را اعمال نمی‌کند؛ آن فیلتر در cycleRunner
// جداگانه (و فقط در لحظه‌ی تصمیم برای اطلاع‌رسانی) اعمال می‌شود تا فرانت بتواند
// همان لیست کامل را با فیلتر لحظه‌ای/محلی نمایش دهد.
function buildHuntRows(computed, settings) {
  var dteMin = settings.dteFilterMin;
  var dteMax = settings.dteFilterMax;
  var out = [];

  var TYPES = ["cc", "mp", "co", "cv", "strangle", "callspread", "putspread", "box"];

  TYPES.forEach(function (type) {
    var list = computed[type] || [];
    list.forEach(function (r) {
      if (typeof r._payoff !== "function") return;
      var dte = r.dte || 0;
      if (dteMin !== "" && dteMin != null && dte < parseFloat(dteMin)) return;
      if (dteMax !== "" && dteMax != null && dte > parseFloat(dteMax)) return;

      var cfg = cfgFor(type, settings);
      var reqShock = Math.max(cfg.shockFloor, dte * cfg.shockRate);
      var reqProfit = Math.max(cfg.profitFloor, dte * cfg.profitRate);

      var negRoi = r._payoff(-reqShock);
      var posRoi = r._payoff(reqShock);
      if (negRoi == null || posRoi == null || isNaN(negRoi) || isNaN(posRoi)) return;

      var worst = Math.min(negRoi, posRoi);
      if (worst < 0) return;

      var roiZero = parseFloat(r.roi_zero);
      if (isNaN(roiZero) || roiZero < reqProfit) return;

      var margin = Math.min(worst, roiZero - reqProfit);

      out.push({
        strategy_type: type,
        primary_name: nameFor(type, r),
        basis_name: r.basis_name,
        expiry: r.expiry,
        dte: dte,
        roi_zero: roiZero,
        required_shock: Math.round(reqShock * 100) / 100,
        required_profit: Math.round(reqProfit * 100) / 100,
        worst_case_roi: Math.round(worst * 100) / 100,
        safety_margin: Math.round(margin * 100) / 100,
        basis_buyable: r.basis_buyable
      });
    });
  });

  out.sort(function (a, b) { return b.safety_margin - a.safety_margin; });
  return out;
}

function huntRowKey(row) {
  return row.strategy_type + "|" + row.primary_name + "|" + row.expiry;
}

module.exports = { buildHuntRows: buildHuntRows, huntRowKey: huntRowKey };