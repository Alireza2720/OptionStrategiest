"use strict";

var NO_SHOCK_TYPES = { cv: true, box: true };
var TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

var SCAN_POINTS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  12, 15, 18, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500];

function cfgFor(type, settings) {
  var src = (settings.huntStrategies && settings.huntStrategies[type]) || {};
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  return {
    shockRate: num(src.shockRate, 0.5),
    profitRate: num(src.profitRate, 0.35),
    telegramEnabled: src.telegramEnabled !== false
  };
}

// اسکن خشن + تنصیف بازه برای پیدا کردن نزدیک‌ترین درصد شوک (در یک جهت) که ROI را منفی می‌کند
var SHOCK_SENTINEL = 999999; // به‌جای Infinity، چون در JSON سریالایز نمی‌شود

function findShockThreshold(payoffFn, sign) {
  var roi0 = payoffFn(0);
  if (roi0 < 0) return 0;
  var prevPct = 0;
  for (var i = 0; i < SCAN_POINTS.length; i++) {
    var mag = sign === 1 ? SCAN_POINTS[i] : Math.min(SCAN_POINTS[i], 99);
    var pct = sign * mag;
    var roi = payoffFn(pct);
    if (roi < 0) {
      var lo = prevPct, hi = pct;
      for (var iter = 0; iter < 40; iter++) {
        var mid = (lo + hi) / 2;
        var midRoi = payoffFn(mid);
        if (midRoi < 0) hi = mid; else lo = mid;
      }
      return Math.abs(hi);
    }
    prevPct = pct;
    if (sign === -1 && mag >= 99) break;
  }
  return SHOCK_SENTINEL;
}

function nameFor(type, row) {
  if (type === "cc" || type === "mp") return row.name;
  if (type === "co" || type === "cv" || type === "strangle" || type === "strangleSell") {
    return row.call_name + " / " + row.put_name;
  }
  if (type === "callspread" || type === "callspreadbear" || type === "putspread" || type === "putspreadbull") {
    return row.buy_name + " / " + row.sell_name;
  }
  if (type === "box") return row.call_buy_name + "/" + row.call_sell_name + "/" + row.put_buy_name + "/" + row.put_sell_name;
  return row.name || "";
}

function buildHuntRows(computed, settings, steps) {
  var onlyBuyable = !!settings.huntOnlyBuyable;
  var dteMin = settings.dteFilterMin, dteMax = settings.dteFilterMax;
  var zeroIdx = steps.indexOf(0);
  if (zeroIdx === -1) zeroIdx = Math.floor(steps.length / 2);
  var out = [];

  TYPES.forEach(function (type) {
    var list = computed[type] || [];
    var cfg = cfgFor(type, settings);
    var isNoShock = !!NO_SHOCK_TYPES[type];

    list.forEach(function (r) {
      if (typeof r._payoff !== "function") return;
      var dte = r.dte || 0;
      if (dteMin !== "" && dteMin != null && dte < parseFloat(dteMin)) return;
      if (dteMax !== "" && dteMax != null && dte > parseFloat(dteMax)) return;
      if (onlyBuyable && r.basis_buyable === false) return;

      var roiZero = parseFloat(r.roi_zero);
      if (isNaN(roiZero)) return;
      var reqProfit = dte * cfg.profitRate;
      if (roiZero < reqProfit) return;

      var actualShockUp = null, actualShockDown = null, minShock = null, reqShock = null;
      if (!isNoShock) {
        reqShock = dte * cfg.shockRate;
        actualShockUp = findShockThreshold(r._payoff, 1);
        actualShockDown = findShockThreshold(r._payoff, -1);
        minShock = Math.min(actualShockUp, actualShockDown);
        if (minShock < reqShock) return;
      }

      var scenAdj, scenRaw;
      if (isNoShock) {
        scenAdj = steps.map(function (_, i) { return i === zeroIdx && r.scenariosAdjusted ? r.scenariosAdjusted[0] : null; });
        scenRaw = steps.map(function (_, i) { return i === zeroIdx && r.scenariosRaw ? r.scenariosRaw[0] : null; });
      } else {
        scenAdj = r.scenariosAdjusted || [];
        scenRaw = r.scenariosRaw || [];
      }

      out.push({
        strategy_type: type, primary_name: nameFor(type, r), basis_name: r.basis_name,
        expiry: r.expiry, dte: dte, roi_zero: roiZero,
        required_shock: reqShock == null ? null : Math.round(reqShock * 100) / 100,
        required_profit: Math.round(reqProfit * 100) / 100,
        actual_shock_up: actualShockUp == null ? null : Math.round(actualShockUp * 100) / 100,
        actual_shock_down: actualShockDown == null ? null : Math.round(actualShockDown * 100) / 100,
        min_shock: minShock == null ? null : Math.round(minShock * 100) / 100,
        telegram_enabled: cfg.telegramEnabled,
        basis_buyable: r.basis_buyable,
        scenariosAdjusted: scenAdj, scenariosRaw: scenRaw
      });
    });
  });

  out.sort(function (a, b) {
    var av = a.min_shock == null ? a.roi_zero : a.min_shock;
    var bv = b.min_shock == null ? b.roi_zero : b.min_shock;
    if (av === Infinity && bv === Infinity) return b.roi_zero - a.roi_zero;
    if (av === Infinity) return -1;
    if (bv === Infinity) return 1;
    return bv - av;
  });
  return out;
}

function huntRowKey(row) { return row.strategy_type + "|" + row.primary_name + "|" + row.expiry; }

module.exports = { buildHuntRows: buildHuntRows, huntRowKey: huntRowKey, TYPES: TYPES, NO_SHOCK_TYPES: NO_SHOCK_TYPES };