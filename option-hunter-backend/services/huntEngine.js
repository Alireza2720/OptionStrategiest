"use strict";

/* کانورژن و باکس بازده ثابتی دارند که مستقل از قیمت سهم پایه است (فقط یک
   سناریو دارند)، بنابراین اصلاً شوک ندارند و فقط شرط سود روی آن‌ها بررسی می‌شود. */
var SHOCKLESS_TYPES = { cv: true, box: true };
var SINGLE_SCEN_TYPES = { cv: true, box: true };

var TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

function nameFor(type, row) {
  if (type === "cc" || type === "mp") return row.name;
  if (type === "co" || type === "cv" || type === "strangle" || type === "strangleSell") return row.call_name + " / " + row.put_name;
  if (type === "callspread" || type === "callspreadbear" || type === "putspread" || type === "putspreadbull") return row.buy_name + " / " + row.sell_name;
  if (type === "box") return row.call_buy_name + "/" + row.call_sell_name + "/" + row.put_buy_name + "/" + row.put_sell_name;
  return row.name || "";
}

/* ---------------------------------------------------------------------
   الگوریتم عمومی «شوک واقعی»: به‌جای فرمول جداگانه برای هر نوع استراتژی،
   مستقیماً روی تابع پیوسته‌ی سود/زیان (_payoff) هر ردیف با اسکن خشن + دقیق‌سازی
   با تنصیف بازه (scan + bisection) اجرا می‌شود.
   خروجی: نزدیک‌ترین فاصله (٪) در جهت مشخص که باعث منفی‌شدن بازده می‌شود؛
   اگر بازده هیچ‌وقت در آن جهت منفی نشود null (بی‌نهایت/بدون شوک) برمی‌گردد.
   --------------------------------------------------------------------- */
var SHOCK_SCAN_STEP = 5;
var SHOCK_SCAN_MAX_UP = 400;   // درصد افزایش قیمت سهم پایه که تا آن اسکن می‌شود
var SHOCK_SCAN_MAX_DOWN = 95;  // قیمت سهم پایه عملاً نمی‌تواند بیش از ۹۵٪ افت کند
var BISECTION_ITER = 40;

function findShockDistance(payoffFn, direction) {
  var maxPct = direction > 0 ? SHOCK_SCAN_MAX_UP : SHOCK_SCAN_MAX_DOWN;
  var prevPct = 0;
  var pct = 0;
  while (true) {
    pct += direction * SHOCK_SCAN_STEP;
    if (Math.abs(pct) > maxPct) return null; // هیچ‌وقت منفی نشد -> بدون شوک (بی‌نهایت)
    var roi;
    try { roi = payoffFn(pct); } catch (e) { return null; }
    if (roi == null || isNaN(roi)) return null;
    if (roi < 0) {
      var lo = prevPct, hi = pct;
      for (var i = 0; i < BISECTION_ITER; i++) {
        var mid = (lo + hi) / 2;
        var midRoi;
        try { midRoi = payoffFn(mid); } catch (e) { midRoi = -1; }
        if (midRoi == null || isNaN(midRoi) || midRoi < 0) hi = mid; else lo = mid;
      }
      return Math.abs(hi);
    }
    prevPct = pct;
  }
}

function computeActualShocks(row) {
  if (typeof row._payoff !== "function") return { up: null, down: null };
  return {
    up: findShockDistance(row._payoff, 1),
    down: findShockDistance(row._payoff, -1)
  };
}

function pickCfg(strategies, type) {
  var cfg = (strategies && strategies[type]) || {};
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  return {
    shockRate: num(cfg.shockRate, 0.5),
    profitRate: num(cfg.profitRate, 0.35),
    telegramEnabled: cfg.telegramEnabled !== false
  };
}

// computed: خروجی computeAll از calcEngine.js
// settings: سند Settings دیتابیس (شامل huntStrategies برای هر نوع)
// steps: همان آرایه‌ی سناریوهایی که برای computeAll استفاده شده
function buildHuntRows(computed, settings, steps) {
  var onlyBuyable = !!settings.huntOnlyBuyable;
  var dteMin = settings.dteFilterMin, dteMax = settings.dteFilterMax;
  var zeroIdx = steps.indexOf(0);
  if (zeroIdx === -1) zeroIdx = Math.floor(steps.length / 2);
  var out = [];

  TYPES.forEach(function (type) {
    var list = computed[type] || [];
    var cfg = pickCfg(settings.huntStrategies, type);
    var isShockless = !!SHOCKLESS_TYPES[type];

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

      var reqShock = null, actualShockUp = null, actualShockDown = null, minActualShock = null;
      if (!isShockless) {
        reqShock = dte * cfg.shockRate;
        var shocks = computeActualShocks(r);
        actualShockUp = shocks.up;
        actualShockDown = shocks.down;
        var upVal = actualShockUp == null ? Infinity : actualShockUp;
        var downVal = actualShockDown == null ? Infinity : actualShockDown;
        var minVal = Math.min(upVal, downVal);
        if (minVal < reqShock) return;
        minActualShock = minVal === Infinity ? null : minVal;
      }

      var scenAdj, scenRaw, rawScenarioList;
      if (SINGLE_SCEN_TYPES[type]) {
        scenAdj = steps.map(function (_, i) { return i === zeroIdx && r.scenariosAdjusted ? r.scenariosAdjusted[0] : null; });
        scenRaw = steps.map(function (_, i) { return i === zeroIdx && r.scenariosRaw ? r.scenariosRaw[0] : null; });
        rawScenarioList = [{ pct: 0, value: r.scenariosRaw ? r.scenariosRaw[0] : roiZero }];
      } else {
        scenAdj = r.scenariosAdjusted || [];
        scenRaw = r.scenariosRaw || [];
        rawScenarioList = steps.map(function (pct, i) { return { pct: pct, value: scenRaw[i] }; });
      }

      out.push({
        strategy_type: type, primary_name: nameFor(type, r), basis_name: r.basis_name,
        expiry: r.expiry, dte: dte, roi_zero: roiZero,
        is_shockless: isShockless,
        required_shock: isShockless || reqShock == null ? null : Math.round(reqShock * 100) / 100,
        required_profit: Math.round(reqProfit * 100) / 100,
        actual_shock_up: actualShockUp == null ? null : Math.round(actualShockUp * 100) / 100,
        actual_shock_down: actualShockDown == null ? null : Math.round(actualShockDown * 100) / 100,
        min_actual_shock: minActualShock == null ? null : Math.round(minActualShock * 100) / 100,
        basis_buyable: r.basis_buyable,
        telegram_enabled: cfg.telegramEnabled,
        scenariosAdjusted: scenAdj, scenariosRaw: scenRaw, rawScenarioList: rawScenarioList
      });
    });
  });

  out.sort(function (a, b) {
    var av = a.is_shockless ? Infinity : (a.min_actual_shock == null ? Infinity : a.min_actual_shock);
    var bv = b.is_shockless ? Infinity : (b.min_actual_shock == null ? Infinity : b.min_actual_shock);
    if (av !== bv) return bv - av;
    return b.roi_zero - a.roi_zero;
  });
  return out;
}

function huntRowKey(row) { return row.strategy_type + "|" + row.primary_name + "|" + row.expiry; }

module.exports = { buildHuntRows: buildHuntRows, huntRowKey: huntRowKey, TYPES: TYPES };
