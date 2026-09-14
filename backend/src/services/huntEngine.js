"use strict";

var NO_SHOCK_TYPES = { cv: true, box: true };
var BUYABLE_CHECK_TYPES = { cc: true, mp: true, co: true, cv: true };
var TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

var SCAN_POINTS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  12, 15, 18, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200, 250, 300, 400, 500];

var VALID_MODES = { rate: true, floor: true, both: true };

function cfgFor(type, settings) {
  var src = (settings.huntStrategies && settings.huntStrategies[type]) || {};
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  function mode(v) { return VALID_MODES[v] ? v : "rate"; }
  return {
    shockRate: num(src.shockRate, 0.5),
    shockMode: mode(src.shockMode),
    shockFloor: num(src.shockFloor, 5),
    profitRate: num(src.profitRate, 0.35),
    profitMode: mode(src.profitMode),
    profitFloor: num(src.profitFloor, 5),
    dteMin: (src.dteMin === undefined || src.dteMin === null) ? "" : String(src.dteMin),
    dteMax: (src.dteMax === undefined || src.dteMax === null) ? "" : String(src.dteMax),
    telegramEnabled: src.telegramEnabled !== false,
    straddleMinPnl: num(src.straddleMinPnl, -10),
    straddleReqShockDown: num(src.straddleReqShockDown, 5),
    straddleReqShockUp: num(src.straddleReqShockUp, 5)
  };
}

function computeThreshold(mode, rateValue, floorValue) {
  if (mode === "floor") return floorValue;
  if (mode === "both") return Math.max(rateValue, floorValue);
  return rateValue;
}

// اسکن خشن + تنصیف بازه برای پیدا کردن نزدیک‌ترین درصد نوسان (در یک جهت) که ROI را منفی می‌کند
var SHOCK_SENTINEL = 999999; // به‌جای Infinity، چون در JSON سریالایز نمی‌شود

// پیمایش کل نمودار برای یافتن کمترین ROI (کف گودال)
function findMinRoi(payoffFn) {
  var minRoi = payoffFn(0);
  for (var i = 0; i < SCAN_POINTS.length; i++) {
    var up = SCAN_POINTS[i];
    var down = Math.min(SCAN_POINTS[i], 99);
    var upRoi = payoffFn(up);
    var downRoi = payoffFn(-down);
    if (upRoi < minRoi) minRoi = upRoi;
    if (downRoi < minRoi) minRoi = downRoi;
  }
  return minRoi;
}

// از قیمت فعلی، چقدر (%) حرکت لازمه تا ROI به صفر (ابتدای سود) برسه.
// اگر در قیمت فعلی دقیقاً سربه‌سر باشیم (roi0 = 0)، دنبال نقطه‌ای می‌گردیم که ROI منفی بشه؛
// اگر هیچ‌وقت منفی نشه (هر نوسانی سود می‌ده), SHOCK_SENTINEL برمی‌گردونیم.
function findShockToZero(payoffFn, sign) {
  var roi0 = payoffFn(0);
  if (!isFinite(roi0)) return SHOCK_SENTINEL;
  var maxPct = sign === 1 ? 500 : 99;
  var step = 0.1;

  if (Math.abs(roi0) < 1e-6) {
    // سربه‌سر هستیم؛ ببینیم با حرکت در این جهت، اصلاً ROI منفی می‌شود یا نه
    for (var p = step; p <= maxPct + 1e-9; p += step) {
      var r = payoffFn(sign * p);
      if (isFinite(r) && r < -1e-6) {
        var lo0 = 0, hi0 = p;
        for (var it0 = 0; it0 < 60; it0++) {
          var mid0 = (lo0 + hi0) / 2;
          var mr0 = payoffFn(sign * mid0);
          if (isFinite(mr0) && mr0 < -1e-6) hi0 = mid0;
          else lo0 = mid0;
        }
        return hi0;
      }
    }
    return SHOCK_SENTINEL;
  }

  var needPositive = roi0 < 0;
  var prevPct = 0;
  for (var pct = step; pct <= maxPct + 1e-9; pct += step) {
    var signed = sign * pct;
    var roi = payoffFn(signed);
    if (!isFinite(roi)) { prevPct = pct; continue; }
    var reached = needPositive ? roi >= 0 : roi <= 0;
    if (reached) {
      var lo = prevPct, hi = pct;
      for (var iter = 0; iter < 60; iter++) {
        var mid = (lo + hi) / 2;
        var midRoi = payoffFn(sign * mid);
        var midReached = needPositive ? midRoi >= 0 : midRoi <= 0;
        if (midReached) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prevPct = pct;
  }
  return SHOCK_SENTINEL;
}

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

// اطلاعات هر پایهٔ قرارداد؛ برای نمایش/کپی جداگانهٔ هرکدام در پیام تلگرام استفاده می‌شود
function legsFor(type, row) {
  if (type === "cc") {
    return [{ label: "فروش", name: row.name, price: row.bid_price }];
  }
  if (type === "mp") {
    return [{ label: "خرید", name: row.name, price: row.ask_price }];
  }
  if (type === "co" || type === "cv") {
    return [
      { label: "خرید پوت", name: row.put_name, price: row.ask_price },
      { label: "فروش کال", name: row.call_name, price: row.bid_price }
    ];
  }
  if (type === "strangle") {
    return [
      { label: "خرید پوت", name: row.put_name, price: row.put_ask_price },
      { label: "خرید کال", name: row.call_name, price: row.call_ask_price }
    ];
  }
  if (type === "strangleSell") {
    return [
      { label: "فروش پوت", name: row.put_name, price: row.put_bid_price },
      { label: "فروش کال", name: row.call_name, price: row.call_bid_price }
    ];
  }
  if (type === "callspread" || type === "callspreadbear" || type === "putspread" || type === "putspreadbull") {
    return [
      { label: "خرید", name: row.buy_name, price: row.buy_ask_price },
      { label: "فروش", name: row.sell_name, price: row.sell_bid_price }
    ];
  }
  if (type === "box") {
    return [
      { label: "خرید", name: row.call_buy_name, price: row.call_buy_ask_price },
      { label: "فروش", name: row.call_sell_name, price: row.call_sell_bid_price },
      { label: "خرید", name: row.put_buy_name, price: row.put_buy_ask_price },
      { label: "فروش", name: row.put_sell_name, price: row.put_sell_bid_price }
    ];
  }
  return [{ label: "", name: row.name || "", price: null }];
}

function dteInRange(dte, minStr, maxStr) {
  if (minStr !== "" && minStr != null && dte < parseFloat(minStr)) return false;
  if (maxStr !== "" && maxStr != null && dte > parseFloat(maxStr)) return false;
  return true;
}

function buildHuntRows(computed, settings, steps) {
  var onlyBuyable = !!settings.huntOnlyBuyable;
  var globalDteMin = settings.dteFilterMin, globalDteMax = settings.dteFilterMax;
  var zeroIdx = steps.indexOf(0);
  if (zeroIdx === -1) zeroIdx = Math.floor(steps.length / 2);
  var out = [];

  TYPES.forEach(function (type) {
    var list = computed[type] || [];
    var cfg = cfgFor(type, settings);
    var isNoShock = !!NO_SHOCK_TYPES[type];
    var dteMin = cfg.dteMin !== "" ? cfg.dteMin : globalDteMin;
    var dteMax = cfg.dteMax !== "" ? cfg.dteMax : globalDteMax;

    list.forEach(function (r) {
      if (typeof r._payoff !== "function") return;
      var dte = r.dte || 0;
      if (!dteInRange(dte, dteMin, dteMax)) return;
      if (onlyBuyable && BUYABLE_CHECK_TYPES[type] && r.basis_buyable === false) return;

      var roiZero = parseFloat(r.roi_zero);
      if (isNaN(roiZero)) return;

      var isStrangleTab = type === "strangle";
      var isActuallyStraddle = isStrangleTab && r.strangle_type === "استرادل";

      var requiredShock = null, requiredProfit = null,
        actualShockUp = null, actualShockDown = null, minShock = null, minPnl = null;

      if (isStrangleTab) {
        minPnl = findMinRoi(r._payoff);
        actualShockUp = findShockToZero(r._payoff, 1);
        actualShockDown = findShockToZero(r._payoff, -1);
        minShock = Math.max(actualShockUp, actualShockDown);
        if (minPnl < cfg.straddleMinPnl) return;
        // اگر شوک = بی‌نهایت یعنی حرکت در آن جهت هیچ‌وقت به زیان نمی‌رسد (خوب است)؛
        // پس فقط وقتی رد می‌کنیم که شوک متناهی و بزرگ‌تر از حد مجاز باشد.
        var upReject = isFinite(actualShockUp) && actualShockUp < SHOCK_SENTINEL && actualShockUp > cfg.straddleReqShockUp;
        var downReject = isFinite(actualShockDown) && actualShockDown < SHOCK_SENTINEL && actualShockDown > cfg.straddleReqShockDown;
        if (upReject || downReject) return;
      } else {
        requiredProfit = computeThreshold(cfg.profitMode, dte * cfg.profitRate, cfg.profitFloor);
        if (roiZero < requiredProfit) return;
        if (!isNoShock) {
          requiredShock = computeThreshold(cfg.shockMode, dte * cfg.shockRate, cfg.shockFloor);
          actualShockUp = findShockThreshold(r._payoff, 1);
          actualShockDown = findShockThreshold(r._payoff, -1);
          minShock = Math.min(actualShockUp, actualShockDown);
          if (minShock < requiredShock) return;
        }
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
        legs: legsFor(type, r),
        expiry: r.expiry, dte: dte, roi_zero: roiZero,
        required_shock: requiredShock == null ? null : Math.round(requiredShock * 100) / 100,
        required_profit: requiredProfit == null ? null : Math.round(requiredProfit * 100) / 100,
        actual_shock_up: actualShockUp == null ? null : Math.round(actualShockUp * 100) / 100,
        actual_shock_down: actualShockDown == null ? null : Math.round(actualShockDown * 100) / 100,
        min_shock: minShock == null ? null : Math.round(minShock * 100) / 100,
        min_pnl: minPnl == null ? null : Math.round(minPnl * 100) / 100,
        is_straddle: isActuallyStraddle,
        telegram_enabled: cfg.telegramEnabled,
        basis_buyable: r.basis_buyable,
        buyable_checked: !!BUYABLE_CHECK_TYPES[type],
        scenariosAdjusted: scenAdj, scenariosRaw: scenRaw
      });
    });
  });

  out.sort(function (a, b) {
    var av = a.min_shock == null ? a.roi_zero : a.min_shock;
    var bv = b.min_shock == null ? b.roi_zero : b.min_shock;
    if (av === SHOCK_SENTINEL && bv === SHOCK_SENTINEL) return b.roi_zero - a.roi_zero;
    if (av === SHOCK_SENTINEL) return -1;
    if (bv === SHOCK_SENTINEL) return 1;
    return bv - av;
  });
  return out;
}

function huntRowKey(row) { return row.strategy_type + "|" + row.primary_name + "|" + row.expiry; }

module.exports = {
  buildHuntRows: buildHuntRows, huntRowKey: huntRowKey, TYPES: TYPES,
  NO_SHOCK_TYPES: NO_SHOCK_TYPES, BUYABLE_CHECK_TYPES: BUYABLE_CHECK_TYPES
};