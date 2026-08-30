"use strict";

var CAT1_TYPES = { cc: true, mp: true, co: true, cv: true };
var SINGLE_SCEN_TYPES = { cv: true, box: true };

function pickCfg(source, defaults) {
  source = source || {};
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
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
  var isCat1 = CAT1_TYPES[type];
  return pickCfg(isCat1 ? settings.huntCat1 : settings.huntCat2, isCat1 ? DEFAULTS.cat1 : DEFAULTS.cat2);
}
function nameFor(type, row) {
  if (type === "cc" || type === "mp") return row.name;
  if (type === "co" || type === "cv" || type === "strangle") return row.call_name + " / " + row.put_name;
  if (type === "callspread" || type === "putspread") return row.buy_name + " / " + row.sell_name;
  if (type === "box") return row.call_buy_name + "/" + row.call_sell_name + "/" + row.put_buy_name + "/" + row.put_sell_name;
  return row.name || "";
}

// computed: خروجی computeAll از calcEngine.js
// settings: سند Settings دیتابیس
// steps: همان آرایه‌ی سناریوهایی که برای computeAll استفاده شده (برای هم‌ترازی ستون‌ها)
function buildHuntRows(computed, settings, steps) {
  var onlyBuyable = !!settings.huntOnlyBuyable;
  var dteMin = settings.dteFilterMin, dteMax = settings.dteFilterMax;
  var zeroIdx = steps.indexOf(0);
  if (zeroIdx === -1) zeroIdx = Math.floor(steps.length / 2);
  var out = [];
  var TYPES = ["cc", "mp", "co", "cv", "strangle", "callspread", "putspread", "box"];

  TYPES.forEach(function (type) {
    var list = computed[type] || [];
    list.forEach(function (r) {
      if (typeof r._payoff !== "function") return;
      var dte = r.dte || 0;
      if (dteMin !== "" && dteMin != null && dte < parseFloat(dteMin)) return;
      if (dteMax !== "" && dteMax != null && dte > parseFloat(dteMax)) return;
      if (onlyBuyable && r.basis_buyable === false) return;

      var cfg = cfgFor(type, settings);
      var reqShock = Math.max(cfg.shockFloor, dte * cfg.shockRate);
      var reqProfit = Math.max(cfg.profitFloor, dte * cfg.profitRate);
      var negRoi = r._payoff(-reqShock), posRoi = r._payoff(reqShock);
      if (negRoi == null || posRoi == null || isNaN(negRoi) || isNaN(posRoi)) return;
      var worst = Math.min(negRoi, posRoi);
      if (worst < 0) return;
      var roiZero = parseFloat(r.roi_zero);
      if (isNaN(roiZero) || roiZero < reqProfit) return;
      var margin = Math.min(worst, roiZero - reqProfit);

      var scenAdj, scenRaw;
      if (SINGLE_SCEN_TYPES[type]) {
        scenAdj = steps.map(function (_, i) { return i === zeroIdx && r.scenariosAdjusted ? r.scenariosAdjusted[0] : null; });
        scenRaw = steps.map(function (_, i) { return i === zeroIdx && r.scenariosRaw ? r.scenariosRaw[0] : null; });
      } else {
        scenAdj = r.scenariosAdjusted || [];
        scenRaw = r.scenariosRaw || [];
      }

      out.push({
        strategy_type: type, primary_name: nameFor(type, r), basis_name: r.basis_name,
        expiry: r.expiry, dte: dte, roi_zero: roiZero,
        required_shock: Math.round(reqShock * 100) / 100,
        required_profit: Math.round(reqProfit * 100) / 100,
        worst_case_roi: Math.round(worst * 100) / 100,
        safety_margin: Math.round(margin * 100) / 100,
        basis_buyable: r.basis_buyable,
        scenariosAdjusted: scenAdj, scenariosRaw: scenRaw
      });
    });
  });
  out.sort(function (a, b) { return b.safety_margin - a.safety_margin; });
  return out;
}

function huntRowKey(row) { return row.strategy_type + "|" + row.primary_name + "|" + row.expiry; }

module.exports = { buildHuntRows: buildHuntRows, huntRowKey: huntRowKey };