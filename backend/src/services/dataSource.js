"use strict";

// ============================================================
// dataSource.js — Parse option chain from OptionHunter proxy
// ============================================================
// Sources (in order of preference):
//   1) OptionHunter proxy (/api/options-chain)   ← primary
//   2) optionschool24 direct                     ← fallback
//
// Field naming convention of OptionHunter proxy:
//   S, strike, expiry, daysLeft, tradingDaysLeft,
//   last, final, yday, bid, bidVol, ask, askVol,
//   volume, value (== Tvalue/ارزش معاملات), intrinsic,
//   bsApi, ivApi, hvApi, deltaApi, gammaApi, thetaApi, vegaApi,
//   oi, oiChange, margin, size, isCall, symbol, fullName, underlying
//
// optionschool24 legacy names (kept for backward compat):
//   basis, emal, to_date, day_left, final_c,
//   black_sholes, imp, sigma, delta, gamma, theta, vega,
//   b_price, s_price, b_volume, s_volume, Tvalue, op
// ============================================================

function sf(v, d) { if (d === undefined) d = 0; var x = parseFloat(v); return isNaN(x) ? d : x; }
function si(v, d) { if (d === undefined) d = 0; var x = parseInt(v, 10); return isNaN(x) ? d : x; }

// برای روزهای مانده — گرد می‌کنیم تا خطای اعشارِ ناشی از truncate پیش نیاد
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
    return Math.round(lastPct * 100) === Math.round(closePct * 100);
  }
  return false;
}

// Primary: OptionHunter backend proxy
// Fallback: direct optionschool24.com
var _PROXY_URL = process.env.OPTIONS_CHAIN_PROXY_URL || "";
var _DIRECT_URL = "https://s3.optionschool24.com/last?type=3";
var TARGET_URL = _PROXY_URL || _DIRECT_URL;

async function fetchRawDataOnce() {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 120000);
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

async function fetchRawData() {
  var attempts = 3;
  var lastErr = null;
  for (var i = 0; i < attempts; i++) {
    try {
      return await fetchRawDataOnce();
    } catch (e) {
      lastErr = e;
      console.error("[dataSource] تلاش " + (i + 1) + " از " + attempts + " ناموفق بود: " + e.message);
      if (i < attempts - 1) await sleep(1000 * Math.pow(2, i));
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
      // ─── Basic identification ───
      var type = si(row.type, 1);
      var isCall = (row.isCall === true)
                   || (row.isCall !== false && type === 1)
                   || (row.isCall === undefined && !String(row.fname || "").startsWith("اخت"));

      // ─── Prices ───
      // در proxy جدید: S (underlying spot), strike, last, final, yday
      // در optionschool24: basis, emal, close, final, yday
      var spot = firstNumber(row, [
        "S", "basis_c", "basis", "basis_last", "basis_price",
        "underlyingPrice", "underlying_price", "basis_c_value", "basisClose"
      ], 0);

      var strike = sf(row.strike || row.emal || 0);
      var finalPrice = sf(row.final || row.last || row.close || 0);
      var lastPrice = sf(row.last || row.close || 0);
      var yday = sf(row.yday || 0);

      // ─── Days ───
      var dte = daysLeft(
        row.daysLeft != null ? row.daysLeft :
        (row.day_left != null ? row.day_left :
          (row.days_left_actual || 0))
      );

      var size = si(row.size || 1000);
      if (spot <= 0 || strike <= 0 || dte <= 0) continue;

      // ─── Percentages ───
      // در proxy: close_c, final_c (نسبت به yday)
      // اگر نبود، از yday محاسبه کن
      var lastPct = sf(row.close_c, NaN);
      var finalPct = sf(row.final_c, NaN);
      if (!isFinite(lastPct) && yday > 0 && lastPrice > 0) {
        lastPct = (lastPrice / yday - 1) * 100;
      }
      if (!isFinite(finalPct) && yday > 0 && finalPrice > 0) {
        finalPct = (finalPrice / yday - 1) * 100;
      }
      if (!isFinite(lastPct)) lastPct = 0;
      if (!isFinite(finalPct)) finalPct = 0;

      // ─── Volume / Value / OI ───
      var high = sf(row.highest_price || row.priceMax || row.high || 0);
      var low  = sf(row.lowest_price  || row.priceMin  || row.low  || 0);
      if (high <= 0) {
        var _hiCands = [lastPrice, finalPrice].filter(function (x) { return x > 0; });
        if (_hiCands.length) high = Math.max.apply(null, _hiCands);
      }
      if (low <= 0) {
        var _loCands = [lastPrice, finalPrice].filter(function (x) { return x > 0; });
        if (_loCands.length) low = Math.min.apply(null, _loCands);
      }
      var volume = sf(row.volume || row.Tvolume || 0);
      // ⚠️ نکته مهم: در proxy جدید، `value` = ارزش معاملات (نه intrinsic)
      // در optionschool24، `Tvalue` = ارزش معاملات
      // پس tvalue از هر دو می‌تونه بیاد
      var tvalue = sf(row.value || row.Tvalue || 0);
      var oi = sf(row.oi || row.op || 0);
      var opChange = sf(row.oiChange || row.op_change || 0);

      // فیلتر tvalue: در optionschool24 قدیم، tvalue < 100000 یعنی noise
      // ولی در proxy جدید ممکنه value=0 برای قراردادهای کم‌معامله باشه
      // پس فقط وقتی tvalue هست ولی خیلی کمه فیلتر می‌کنیم
      // (ردیف‌های value=0 یا خیلی کم رو نه — چون ممکنه بدون معامله باشن)
      // این فیلتر حذف شد چون باعث از دست دادن ردیف‌های معتبر می‌شد.

      // ─── Intrinsic / time value / be ───
      // ⚠️ مهم: در proxy جدید، `intrinsic` جدا هست (نه value)
      var intrinsic = sf(row.intrinsic, NaN);
      if (!isFinite(intrinsic)) {
        // fallback legacy: در optionschool24 `value` = intrinsic
        intrinsic = sf(row.value || 0);
        // ولی اگر value خیلی بزرگ باشه (ارزش معاملات)، اشتباهه
        if (intrinsic > spot * 10) intrinsic = 0;
      }
      var priceForTimeVal = lastPrice > 0 ? lastPrice : finalPrice;
      var timeVal = Math.max(0, priceForTimeVal - intrinsic);
      var priceForBe = lastPrice > 0 ? lastPrice : finalPrice;
      var be = isCall ? strike + priceForBe : strike - priceForBe;
      var beDiff = spot > 0 ? (be - spot) / spot * 100 : 0;
      var strikeDiff = strike > 0 ? (spot - strike) / strike * 100 : 0;

      // ─── Greeks / IV / HV ───
      // proxy: bsApi, ivApi, hvApi, deltaApi, gammaApi, thetaApi, vegaApi
      // legacy: black_sholes, imp, sigma, delta, gamma, theta, vega, rho
      var bs = sf(row.bsApi || row.black_sholes || 0);
      var bsDiff = 0;
      if (bs > 0 && lastPrice > 0) {
        bsDiff = (lastPrice - bs) / bs * 100;
      }
      var iv = sf(row.ivApi || row.imp || 0);
      var histVol = sf(row.hvApi || row.sigma || 0);
      var delta = sf(row.deltaApi || row.delta || 0);
      var thetaRaw = sf(row.thetaApi || row.theta || 0);
      var theta = thetaRaw / 365;
      var gamma = sf(row.gammaApi || row.gamma || 0);
      var vegaRaw = sf(row.vegaApi || row.vega || 0);
      var vega = vegaRaw / 100;
      var rhoRaw = sf(row.rhoApi || row.rho || 0);
      var rho = rhoRaw / 100;

      var levBase = lastPrice > 0 ? lastPrice : finalPrice;
      var leverage = levBase > 0 && delta !== 0 ? Math.abs(delta * spot / levBase) : 0;

      // ─── Bid / Ask ───
      // proxy: bid, bidVol, ask, askVol
      // legacy: b_price ("price/vol"), s_price ("price/vol"), b_volume, s_volume
      var bidPrice = sf(row.bid || 0);
      var bidVol = sf(row.bidVol || 0);
      var askPrice = sf(row.ask || 0);
      var askVol = sf(row.askVol || 0);

      if (!bidPrice && row.b_price) {
        var bP = parsePriceVol(row.b_price);
        bidPrice = bP[0] || 0;
        if (!bidVol && bP[1]) bidVol = bP[1];
      }
      if (!askPrice && row.s_price) {
        var sP = parsePriceVol(row.s_price);
        askPrice = sP[0] || 0;
        if (!askVol && sP[1]) askVol = sP[1];
      }
      if (!bidVol && row.b_volume) bidVol = sf(row.b_volume);
      if (!askVol && row.s_volume) askVol = sf(row.s_volume);

      // ✅ محافظت: هرگز bid نباید بزرگ‌تر از ask باشد.
      if (askPrice > 0 && bidPrice > 0 && bidPrice > askPrice) {
        var tmpP = bidPrice; bidPrice = askPrice; askPrice = tmpP;
        var tmpV = bidVol; bidVol = askVol; askVol = tmpV;
      }

      var spread = askPrice > 0 && bidPrice > 0 ? askPrice - bidPrice : 0;

      // ─── Trading days ───
      var tradingDays = si(firstNumber(row, [
        "tradingDaysLeft",
        "trading_days_left",
        "dey_left_actual",
        "day_left_actual",
        "days_left_actual",
        "trading_day_left",
        "business_days_left",
        "dey_left",
        "day_left_trade"
      ], 0), 0);

      // ─── Status ───
      var rawStatus = String(row.status_text || row.statusText || "")
        || (isCall
          ? (spot > strike ? "ITM" : spot < strike ? "OTM" : "ATM")
          : (spot < strike ? "ITM" : spot > strike ? "OTM" : "ATM"));
      var status = rawStatus.indexOf("سود") !== -1 ? "ITM"
                 : rawStatus.indexOf("ضرر") !== -1 ? "OTM"
                 : rawStatus.indexOf("تفاوت") !== -1 ? "ATM"
                 : rawStatus;

      // ─── Basis percentages ───
      // proxy این‌ها رو نمی‌فرسته، پس از yday استفاده نمی‌کنیم
      // (yday خود قرارداده نه سهم پایه). این مقادیر 0 می‌مونن
      // و در dedupeAndFlagBuyable به عنوان pending علامت می‌خورن.
      var basisLastPercent = firstNumber(row, ["basis_c_percent", "basis_last_percent"], 0);
      var basisClosePercent = firstNumber(row, ["basis_percent", "basis_close_percent", "basis_pc_percent", "basis_final_percent"], 0);

      var _splitBasisPV = function (raw) {
        if (raw == null || raw === "" || raw === "0") return [0, 0];
        var s = String(raw);
        if (s.indexOf("/") !== -1) { var p = s.split("/"); return [parseFloat(p[0])||0, parseFloat(p[1])||0]; }
        return [parseFloat(s)||0, 0];
      };
      var _bbPV = _splitBasisPV(row.basis_b_price != null ? row.basis_b_price : row.basisBidPrice);
      var _bsPV = _splitBasisPV(row.basis_s_price != null ? row.basis_s_price : row.basisAskPrice);
      var basisBidPrice = firstNumber(row, ["basis_bid_price","basisBidPrice"], _bbPV[0]);
      var basisBidVol   = firstNumber(row, ["basis_b_volume","basis_bid_volume","basisBidVol"], _bbPV[1]);
      var basisAskPrice = firstNumber(row, ["basis_ask_price","basisAskPrice"], _bsPV[0]);
      var basisAskVol   = firstNumber(row, ["basis_s_volume","basis_ask_volume","basisAskVol"], _bsPV[1]);
      if (basisAskPrice > 0 && basisBidPrice > 0 && basisBidPrice > basisAskPrice) {
        var _tp = basisBidPrice; basisBidPrice = basisAskPrice; basisAskPrice = _tp;
        var _tv = basisBidVol;   basisBidVol   = basisAskVol;   basisAskVol   = _tv;
      }

      var _splitBasisPV = function (raw) {
        if (raw == null || raw === "" || raw === "0") return [0, 0];
        var s = String(raw);
        if (s.indexOf("/") !== -1) { var p = s.split("/"); return [parseFloat(p[0])||0, parseFloat(p[1])||0]; }
        return [parseFloat(s)||0, 0];
      };
      var _bbPV = _splitBasisPV(row.basis_b_price != null ? row.basis_b_price : row.basisBidPrice);
      var _bsPV = _splitBasisPV(row.basis_s_price != null ? row.basis_s_price : row.basisAskPrice);
      var basisBidPrice = firstNumber(row, ["basis_bid_price","basisBidPrice"], _bbPV[0]);
      var basisBidVol   = firstNumber(row, ["basis_b_volume","basis_bid_volume","basisBidVol"], _bbPV[1]);
      var basisAskPrice = firstNumber(row, ["basis_ask_price","basisAskPrice"], _bsPV[0]);
      var basisAskVol   = firstNumber(row, ["basis_s_volume","basis_ask_volume","basisAskVol"], _bsPV[1]);
      if (basisAskPrice > 0 && basisBidPrice > 0 && basisBidPrice > basisAskPrice) {
        var _tp = basisBidPrice; basisBidPrice = basisAskPrice; basisAskPrice = _tp;
        var _tv = basisBidVol;   basisBidVol   = basisAskVol;   basisAskVol   = _tv;
      }

      // ─── Expiry ───
      var expiry = String(row.expiry || row.to_date || "");

      // ─── Margin ───
      var margin = sf(row.margin || row.tazmin_3 || row.tazmin3 || row.tazmin || 0);

      // ─── Symbol / Underlying ───
      var name = String(row.symbol || row.name || "");
      var basisName = String(row.underlyingRaw || row.underlying || row.basis_name || "");

      out.push({
        name: name,
        basis_name: basisName,
        type: isCall ? "call" : "put",
        strike: strike,
        spot: spot,
        price: finalPrice,

        // ✅ فقط وقتی هم bid و هم vol معتبر باشن، قابل خرید/فروش
        buy_price: askPrice > 0 && askVol > 0 ? askPrice : 0,
        sell_price: bidPrice > 0 && bidVol > 0 ? bidPrice : 0,

        end_price: lastPrice,
        end_pct: lastPct,
        final_pct: finalPct,
        low: low,
        high: high,

        intrinsic: intrinsic,
        time_val: timeVal,
        be: be,
        be_diff: beDiff,
        strike_diff: strikeDiff,

        bs: bs,
        bs_diff: bsDiff,
        volume: volume,
        tvalue: tvalue,
        oi: oi,
        op_change: opChange,

        trading_days: tradingDays,
        dte: dte,
        size: size,
        expiry: expiry,

        iv: iv,
        hist_vol: histVol,
        delta: delta,
        theta: theta,
        gamma: gamma,
        vega: vega,
        rho: rho,

        leverage: leverage,

        bid_price: bidPrice,
        bid_vol: bidVol,
        ask_price: askPrice,
        ask_vol: askVol,

        spread: spread,
        margin: margin,
        status: status,

        basis_last_percent: basisLastPercent,
        basis_close_percent: basisClosePercent,
        basis_bid_price: basisBidPrice,
        basis_bid_vol: basisBidVol,
        basis_ask_price: basisAskPrice,
        basis_ask_vol: basisAskVol,

        _raw: row
      });
    } catch (e) {
      // ردیف خراب — رد شود
    }
  }
  return out;
}

function dedupeAndFlagBuyable(contracts) {
  // نرمال‌سازی درصدهای سهم پایه (اگر داده آمده بود)
  var basisBest = {};
  contracts.forEach(function (c) {
    if (!c.basis_name) return;
    var lp = c.basis_last_percent, cp = c.basis_close_percent;
    var bbp = c.basis_bid_price, bbv = c.basis_bid_vol;
    var bap = c.basis_ask_price, bav = c.basis_ask_vol;
    if (!basisBest[c.basis_name]) {
      basisBest[c.basis_name] = { last: lp, close: cp, bidPrice: bbp, bidVol: bbv, askPrice: bap, askVol: bav };
    } else {
      var b = basisBest[c.basis_name];
      if (lp != null && !isNaN(lp) && (b.last == null || isNaN(b.last) || Math.abs(lp) > Math.abs(b.last))) b.last = lp;
      if (cp != null && !isNaN(cp) && (b.close == null || isNaN(b.close) || Math.abs(cp) > Math.abs(b.close))) b.close = cp;
      if (bbv > 0 && (!(b.bidVol > 0) || bbv > b.bidVol)) { b.bidVol = bbv; b.bidPrice = bbp; }
      if (bav > 0 && (!(b.askVol > 0) || bav > b.askVol)) { b.askVol = bav; b.askPrice = bap; }
    }
  });

  contracts.forEach(function (c) {
    if (c.basis_name && basisBest[c.basis_name]) {
      var b = basisBest[c.basis_name];
      c.basis_last_percent = b.last;
      c.basis_close_percent = b.close;
      c.basis_bid_price = b.bidPrice || 0;
      c.basis_bid_vol   = b.bidVol   || 0;
      c.basis_ask_price = b.askPrice || 0;
      c.basis_ask_vol   = b.askVol   || 0;
    }
    var hasAsk   = (c.basis_ask_vol > 0 && c.basis_ask_price > 0);
    var hasBasis = (c.basis_ask_vol > 0 || c.basis_ask_price > 0 ||
                    c.basis_bid_vol > 0 || c.basis_bid_price > 0 ||
                    c.basis_last_percent != null || c.basis_close_percent != null);
    if (hasAsk) { c.basis_buyable = true; c.basis_data_pending = false; }
    else if (hasBasis) { c.basis_buyable = false; c.basis_data_pending = false; }
    else { c.basis_buyable = true; c.basis_data_pending = true; }
  });

  // Dedupe by name+expiry، بهترین bid/ask از هر کپی رو نگه دار
  var map = {};
  contracts.forEach(function (c) {
    var key = c.name + "|" + c.expiry;
    if (!map[key]) { map[key] = c; return; }
    var old = map[key];
    var merged = Object.assign({}, old);
    if (c.ask_vol > 0 && c.ask_price > 0) {
      if (!(old.ask_vol > 0 && old.ask_price > 0) || c.ask_price < old.ask_price) {
        merged.ask_price = c.ask_price;
        merged.ask_vol = c.ask_vol;
      }
    }
    if (c.bid_vol > 0 && c.bid_price > 0) {
      if (!(old.bid_vol > 0 && old.bid_price > 0) || c.bid_price > old.bid_price) {
        merged.bid_price = c.bid_price;
        merged.bid_vol = c.bid_vol;
      }
    }
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
