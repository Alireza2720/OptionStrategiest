"use strict";

/*
  دسته‌بندی استراتژی‌ها برای شکار موقعیت:
  - دسته ۱ (huntCat1): کاوردکال، مریدپوت، کلار، کانورژن
  - دسته ۲ (huntCat2): استرانگل خرید/فروش، کال‌اسپرد صعودی/نزولی، پوت‌اسپرد صعودی/نزولی، باکس
  - کانورژن و باکس بازده ثابت دارند (مستقل از قیمت سهم پایه) پس اصلاً شوک ندارند؛
    فقط شرط سود روی آن‌ها اعمال می‌شود (کانورژن با نرخ سود دسته ۱، باکس با نرخ سود دسته ۲).
*/
var CAT1_TYPES = { cc: true, mp: true, co: true, cv: true };
var NO_SHOCK_TYPES = { cv: true, box: true };
var SINGLE_SCEN_TYPES = { cv: true, box: true };
var ALL_TYPES = ["cc", "mp", "co", "cv", "strangle", "strangleSell",
  "callspread", "callspreadbear", "putspread", "putspreadbull", "box"];

// هر عدد شوک واقعی که بزرگ‌تر یا مساوی این مقدار باشد یعنی «نامحدود» (هیچ‌وقت باعث ضرر نمی‌شود)
var SHOCK_INF = 999999;

function pickCfg(source, defaults) {
  source = source || {};
  function num(v, d) { var x = parseFloat(v); return isNaN(x) ? d : x; }
  return {
    shockRate: num(source.shockRate, defaults.shockRate),
    profitRate: num(source.profitRate, defaults.profitRate)
  };
}
var DEFAULTS = {
  cat1: { shockRate: 0.5, profitRate: 0.35 },
  cat2: { shockRate: 0.5, profitRate: 0.7 }
};
function cfgFor(type, settings) {
  var isCat1 = CAT1_TYPES[type];
  return pickCfg(isCat1 ? settings.huntCat1 : settings.huntCat2, isCat1 ? DEFAULTS.cat1 : DEFAULTS.cat2);
}
function nameFor(type, row) {
  if (type === "cc" || type === "mp") return row.name;
  if (type === "co" || type === "cv" || type === "strangle" || type === "strangleSell") return row.call_name + " / " + row.put_name;
  if (type === "callspread" || type === "putspread" || type === "callspreadbear" || type === "putspreadbull") return row.buy_name + " / " + row.sell_name;
  if (type === "box") return row.call_buy_name + "/" + row.call_sell_name + "/" + row.put_buy_name + "/" + row.put_sell_name;
  return row.name || "";
}

/*
  یافتن نزدیک‌ترین نقطه‌ای که تابع payoff (نسبت به درصد تغییر قیمت سهم پایه) منفی می‌شود،
  به‌صورت عمومی (بدون فرمول‌نویسی جداگانه برای هر استراتژی): ابتدا با گام‌های نمایی
  (۰٫۵٪، سپس ×۱٫۶ در هر مرحله) اسکن می‌کنیم تا اولین بازه‌ای که علامت payoff عوض می‌شود
  پیدا شود، سپس با تنصیف بازه (bisection) دقیق‌سازی می‌کنیم.
  direction=+1 یعنی جستجو در جهت رشد قیمت، direction=-1 یعنی جستجو در جهت افت قیمت.
  خروجی: Infinity یعنی در این جهت هیچ‌وقت باعث ضرر نمی‌شود.
*/
function bisect(payoffFn, safePt, unsafePt, iterations) {
  var lo = safePt, hi = unsafePt;
  for (var i = 0; i < iterations; i++) {
    var mid = (lo + hi) / 2;
    var v = payoffFn(mid);
    if (v == null || isNaN(v) || v < 0) hi = mid; else lo = mid;
  }
  return hi;
}
function findShockEdge(payoffFn, direction) {
  var maxAbs = direction > 0 ? 2000 : 99.9;
  var val0 = payoffFn(0);
  if (val0 == null || isNaN(val0)) return null;
  if (val0 < 0) return 0;
  var prevPct = 0;
  var cur = 0.5;
  while (true) {
    var testPct = direction * Math.min(cur, maxAbs);
    var val = payoffFn(testPct);
    if (val == null || isNaN(val)) return null;
    if (val < 0) return Math.abs(bisect(payoffFn, prevPct, testPct, 40));
    if (Math.abs(testPct) >= maxAbs - 1e-9) return Infinity;
    prevPct = testPct;
    cur *= 1.6;
  }
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

  ALL_TYPES.forEach(function (type) {
    var list = computed[type] || [];
    list.forEach(function (r) {
      if (typeof r._payoff !== "function") return;
      var dte = r.dte || 0;
      if (dteMin !== "" && dteMin != null && dte < parseFloat(dteMin)) return;
      if (dteMax !== "" && dteMax != null && dte > parseFloat(dteMax)) return;
      if (onlyBuyable && r.basis_buyable === false) return;

      var cfg = cfgFor(type, settings);
      var reqProfit = dte * cfg.profitRate;
      var roiZero = parseFloat(r.roi_zero);
      if (isNaN(roiZero) || roiZero < reqProfit) return;

      var reqShock = null, shockUp = null, shockDown = null, minShock = SHOCK_INF;
      if (!NO_SHOCK_TYPES[type]) {
        reqShock = dte * cfg.shockRate;
        var rawUp = findShockEdge(r._payoff, 1);
        var rawDown = findShockEdge(r._payoff, -1);
        if (rawUp == null || rawDown == null) return; // تابع payoff نامعتبر بود
        shockUp = rawUp === Infinity ? SHOCK_INF : rawUp;
        shockDown = rawDown === Infinity ? SHOCK_INF : rawDown;
        minShock = Math.min(shockUp, shockDown);
        if (minShock < reqShock) return;
      }

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
        required_shock: reqShock == null ? null : Math.round(reqShock * 100) / 100,
        required_profit: Math.round(reqProfit * 100) / 100,
        actual_shock_up: shockUp == null ? null : Math.round(shockUp * 100) / 100,
        actual_shock_down: shockDown == null ? null : Math.round(shockDown * 100) / 100,
        min_actual_shock: Math.round(minShock * 100) / 100,
        basis_buyable: r.basis_buyable,
        scenariosAdjusted: scenAdj, scenariosRaw: scenRaw
      });
    });
  });
  out.sort(function (a, b) {
    if (b.min_actual_shock !== a.min_actual_shock) return b.min_actual_shock - a.min_actual_shock;
    return b.roi_zero - a.roi_zero;
  });
  return out;
}

function huntRowKey(row) { return row.strategy_type + "|" + row.primary_name + "|" + row.expiry; }

module.exports = { buildHuntRows: buildHuntRows, huntRowKey: huntRowKey, SHOCK_INF: SHOCK_INF };
