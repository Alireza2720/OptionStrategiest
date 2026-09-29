"use strict";

function sf(v, d) { if (d === undefined) d = 0; var x = parseFloat(v); return isNaN(x) ? d : x; }
function si(v, d) { if (d === undefined) d = 0; var x = parseInt(v, 10); return isNaN(x) ? d : x; }
// ✅ برای روزهای مانده که ممکن است اعشاری باشد و truncate شدنش خطای یک‌روزه ایجاد کند
function daysLeft(v, d) {
  if (d === undefined) d = 0;
  var x = parseFloat(v);
  if (isNaN(x)) return d;
  return Math.max(0, Math.round(x));
}

function firstNumber(row, keys, fallback) {
  for (var i = 0; i < keys.length; i++) {
    var v = row[keys[i]];
    if (v !== undefined && v !== null && v !== "" && !isNaN(parseFloat(v))) return sf(v);
  }
  return fallback === undefined ? 0 : fallback;
}

function parsePriceVol(str) {
  if (!str || str === "0") return [];
  return String(str).split("/").map(function (v) { return parseFloat(v) || 0; });
}

function isStockInBuyQueue(lastPct, closePct) {
  if (lastPct == null || isNaN(lastPct)) return false;
  // صف خرید قطعی: 2.77 تا 3 یا 3.77 تا 4
  if (lastPct >= 2.77 && lastPct <= 3) return true;
  if (lastPct >= 3.77 && lastPct <= 4) return true;
  // محدوده مشکوک 2.66 تا 2.76: فقط اگر آخرین == پایانی (با تحمل اعشار)
  if (lastPct >= 2.66 && lastPct <= 2.76) {
    if (closePct == null || isNaN(closePct)) return false;
    // گرد کردن به دو رقم اعشار قبل از مقایسه (رفع float precision)
    return Math.round(lastPct * 100) === Math.round(closePct * 100);
  }
  return false;
}

var TARGET_URL = "https://s3.optionschool24.com/last?type=3";

async function fetchRawDataOnce() {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 15000);
  try {
    var res = await fetch(TARGET_URL, { signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var json = await res.json();
    var arr = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : null);
    if (!arr || arr.length < 10) throw new Error("داده نامعتبر دریافت شد");
    return arr;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

// در صورت خطای موقت (قطعی شبکه، تایم‌اوت و ...) حداکثر ۳ بار با فاصله‌ی افزایشی تلاش مجدد می‌شود
async function fetchRawData() {
  var attempts = 3;
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    try {
      return await fetchRawDataOnce();
    } catch (e) {
      lastErr = e;
      console.error("[dataSource] تلاش " + (i + 1) + " از " + attempts + " ناموفق بود: " + e.message);
      if (i < attempts - 1) await sleep(1000 * Math.pow(2, i)); // 1s, 2s
    }
  }
  throw lastErr;
}

function parseContracts(raw) {
  var out = [];
  for (var ri = 0; ri < raw.length; ri++) {
    var row = raw[ri];
    if (!row || typeof row !== "object") continue;
    try {
      var type = si(row.type, 1);
      var spot = firstNumber(row, ["basis_c", "basis", "basis_last", "basis_price"], 0);
      var strike = sf(row.emal || 0);
      var finalPrice = sf(row.final || 0);
      var dte = daysLeft(row.day_left || 0);
      var size = si(row.size || 1000);
      if (spot <= 0 || strike <= 0 || dte <= 0) continue;

      var isCall = type === 1;
      var lastPrice = sf(row.close || 0);
      var lastPct = sf(row.close_c || 0);
      var finalPct = sf(row.final_c || 0);
      var high = sf(row.highest_price || 0);
      var low = sf(row.lowest_price || 0);
      var volume = sf(row.Tvolume || 0);
      var tvalue = sf(row.Tvalue || 0);
      var oi = sf(row.op || 0);
      var opChange = sf(row.op_change || 0);
      if (tvalue < 100000) continue;

      var intrinsic = sf(row.value || 0);
      var priceForTimeVal = lastPrice > 0 ? lastPrice : finalPrice;
      var timeVal = Math.max(0, priceForTimeVal - intrinsic);
      var priceForBe = lastPrice > 0 ? lastPrice : finalPrice;
      var be = isCall ? strike + priceForBe : strike - priceForBe;
      var beDiff = spot > 0 ? (be - spot) / spot * 100 : 0;
      var strikeDiff = strike > 0 ? (spot - strike) / strike * 100 : 0;
      var bs = sf(row.black_sholes || 0);
      var bsDiff = sf(row.bs_d || 0);
      var iv = sf(row.imp || 0);
      var histVol = sf(row.sigma || 0);
      var delta = sf(row.delta || 0);
      var theta = sf(row.theta || 0) / 365;
      var gamma = sf(row.gamma || 0);
      var vega = sf(row.vega || 0) / 100;
      var rho = sf(row.rho || 0) / 100;
      var levBase = lastPrice > 0 ? lastPrice : finalPrice;
      var leverage = levBase > 0 && delta !== 0 ? Math.abs(delta * spot / levBase) : 0;

      var bPrices = parsePriceVol(row.b_price);
      var bVolumes = parsePriceVol(row.b_volume);
      var sPrices = parsePriceVol(row.s_price);
      var sVolumes = parsePriceVol(row.s_volume);
      var bidPrice = bPrices[0] || 0;
      var bidVol = bVolumes[0] || 0;
      var askPrice = sPrices[0] || 0;
      var askVol = sVolumes[0] || 0;
      // ✅ محافظت: هرگز bid نباید بزرگ‌تر از ask باشد.
      // اگر API داده‌ی ناسازگار فرستاد (bid > ask)، جای دو طرف را عوض می‌کنیم
      // تا از سیگنال نادرست در استراتژی‌های آربیتراژ مثل باکس جلوگیری شود.
      if (askPrice > 0 && bidPrice > 0 && bidPrice > askPrice) {
        var tmpP = bidPrice; bidPrice = askPrice; askPrice = tmpP;
        var tmpV = bidVol; bidVol = askVol; askVol = tmpV;
      }
      var spread = askPrice > 0 && bidPrice > 0 ? askPrice - bidPrice : 0;

      var tradingDays = si(firstNumber(row, [
        "dey_left_actual", "day_left_actual", "days_left_actual",
        "trading_days_left", "trading_day_left", "business_days_left",
        "dey_left", "day_left_trade"
      ], 0), 0);

      var rawStatus = String(row.status_text || "") || (isCall ? (spot > strike ? "ITM" : spot < strike ? "OTM" : "ATM") : (spot < strike ? "ITM" : spot > strike ? "OTM" : "ATM"));
      var status = rawStatus.indexOf("سود") !== -1 ? "ITM" : rawStatus.indexOf("ضرر") !== -1 ? "OTM" : rawStatus.indexOf("تفاوت") !== -1 ? "ATM" : rawStatus;

      var basisLastPercent = firstNumber(row, ["basis_c_percent", "basis_last_percent"], 0);
      var basisClosePercent = firstNumber(row, ["basis_percent", "basis_close_percent", "basis_pc_percent", "basis_final_percent"], 0);

      out.push({
        name: String(row.name || ""), basis_name: String(row.basis_name || ""),
        type: isCall ? "call" : "put", strike: strike, spot: spot, price: finalPrice,
        // ✅ به‌جای fallback به قیمت پایانی، صفر می‌گذاریم تا canBuyOpt/canSellOpt ردیف را رد کند
        buy_price: askPrice > 0 && askVol > 0 ? askPrice : 0,
        sell_price: bidPrice > 0 && bidVol > 0 ? bidPrice : 0,
        end_price: lastPrice, end_pct: lastPct, final_pct: finalPct, low: low, high: high,
        intrinsic: intrinsic, time_val: timeVal, be: be, be_diff: beDiff, strike_diff: strikeDiff,
        bs: bs, bs_diff: bsDiff, volume: volume, tvalue: tvalue, oi: oi, op_change: opChange,
        trading_days: tradingDays, dte: dte, size: size, expiry: String(row.to_date || ""),
        iv: iv, hist_vol: histVol, delta: delta, theta: theta, gamma: gamma, vega: vega, rho: rho,
        leverage: leverage, bid_price: bidPrice, bid_vol: bidVol, ask_price: askPrice, ask_vol: askVol,
        spread: spread, margin: sf(row.tazmin_3 || row.tazmin3 || row.tazmin || 0), status: status,
        basis_last_percent: basisLastPercent, basis_close_percent: basisClosePercent,
        _raw: row
      });
    } catch (e) { /* رد شدن از ردیف خراب */ }
  }
  return out;
}

function dedupeAndFlagBuyable(contracts) {
  // نرمال‌سازی درصدهای سهم پایه: برای هر سهم پایه، بزرگ‌ترین قدر مطلق درصد را در نظر می‌گیریم
  // (چون API ممکن است برای قراردادهای مختلف یک سهم، مقادیر ناهمگون برگرداند)
  var basisBest = {};
  contracts.forEach(function (c) {
    if (!c.basis_name) return;
    var lp = c.basis_last_percent;
    var cp = c.basis_close_percent;
    if (!basisBest[c.basis_name]) {
      basisBest[c.basis_name] = { last: lp, close: cp };
    } else {
      var b = basisBest[c.basis_name];
      if (lp != null && !isNaN(lp) && (b.last == null || isNaN(b.last) || Math.abs(lp) > Math.abs(b.last))) b.last = lp;
      if (cp != null && !isNaN(cp) && (b.close == null || isNaN(b.close) || Math.abs(cp) > Math.abs(b.close))) b.close = cp;
    }
  });

  contracts.forEach(function (c) {
    if (c.basis_name && basisBest[c.basis_name]) {
      c.basis_last_percent = basisBest[c.basis_name].last;
      c.basis_close_percent = basisBest[c.basis_name].close;
    }
    var lp = c.basis_last_percent;
    var cp = c.basis_close_percent;
    var lpZero = (lp == null || isNaN(lp) || lp === 0);
    var cpZero = (cp == null || isNaN(cp) || cp === 0);
    // اگر هر دو درصد صفر/نامعتبر باشن، یعنی API هنوز داده رو پر نکرده.
    // برای امنیت، این سهم رو «غیرقابل خرید» علامت می‌زنیم تا سیگنال نادرست ندیم.
    if (lpZero && cpZero) {
      c.basis_buyable = false;
      c.basis_data_pending = true;
    } else {
      c.basis_buyable = !isStockInBuyQueue(lp, cp);
      c.basis_data_pending = false;
    }
  });

var map = {};
  contracts.forEach(function (c) {
    var key = c.name + "|" + c.expiry;
    if (!map[key]) { map[key] = c; return; }
    var old = map[key];
    // Merge: بهترین ask و بهترین bid را از هر دو ردیف بردار
    var merged = Object.assign({}, old);
    // ask: اگر ردیف جدید ask معتبر دارد و قدیمی ندارد، یا ask جدید بهتر است (کمتر)، از جدید بگیر
    if (c.ask_vol > 0 && c.ask_price > 0) {
      if (!(old.ask_vol > 0 && old.ask_price > 0) || c.ask_price < old.ask_price) {
        merged.ask_price = c.ask_price;
        merged.ask_vol = c.ask_vol;
      }
    }
    // bid: اگر ردیف جدید bid معتبر دارد و قدیمی ندارد، یا bid جدید بهتر است (بیشتر)، از جدید بگیر
    if (c.bid_vol > 0 && c.bid_price > 0) {
      if (!(old.bid_vol > 0 && old.bid_price > 0) || c.bid_price > old.bid_price) {
        merged.bid_price = c.bid_price;
        merged.bid_vol = c.bid_vol;
      }
    }
    // buy_price و sell_price را هم به‌روز کن
    merged.buy_price = merged.ask_price > 0 && merged.ask_vol > 0 ? merged.ask_price : 0;
    merged.sell_price = merged.bid_price > 0 && merged.bid_vol > 0 ? merged.bid_price : 0;
    map[key] = merged;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

async function loadContracts() {
  var t0 = Date.now();
  var raw = await fetchRawData();
  var t1 = Date.now();
  var crypto = require("crypto");
  var meta = {
    fetchedAt: new Date(t1),
    fetchMs: t1 - t0,
    rowCount: Array.isArray(raw) ? raw.length : 0,
    sample: (Array.isArray(raw) && raw.length > 0) ? raw[0] : null
  };
  try {
    meta.hash = crypto.createHash("md5").update(JSON.stringify(raw)).digest("hex");
  } catch (e) {
    meta.hash = null;
  }
  var parsed = parseContracts(raw);
  var deduped = dedupeAndFlagBuyable(parsed);
  var calls = deduped.filter(function (c) { return c.type === "call"; });
  var puts = deduped.filter(function (c) { return c.type === "put"; });
  return { calls: calls, puts: puts, all: deduped, meta: meta };
}

module.exports = {
  loadContracts: loadContracts,
  fetchRawDataOnce: fetchRawDataOnce,
  parseContracts: parseContracts,
  dedupeAndFlagBuyable: dedupeAndFlagBuyable
};