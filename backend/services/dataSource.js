"use strict";

function sf(v, d) { if (d === undefined) d = 0; var x = parseFloat(v); return isNaN(x) ? d : x; }
function si(v, d) { if (d === undefined) d = 0; var x = parseInt(v, 10); return isNaN(x) ? d : x; }

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

/*
  قانون جدید تشخیص «صف خرید» سهم پایه (نتیجه = true یعنی در صف خرید و غیرقابل‌خرید است):
  الف) اگر آخرین درصد قیمت بین ۲.۷۷ تا ۳ یا بین ۳.۷۷ تا ۴ باشد → غیرقابل‌خرید
  ب) اگر بین ۲.۶۶ تا ۲.۷۶ یا بین ۳.۶۶ تا ۳.۷۶ باشد و آخرین درصد == درصد پایانی → غیرقابل‌خرید
  ج) در غیر این صورت → قابل‌خرید
*/
function isStockInBuyQueue(lastPct, closePct) {
  if (lastPct == null || isNaN(lastPct)) return false;
  var inHighBand = (lastPct >= 2.77 && lastPct <= 3) || (lastPct >= 3.77 && lastPct <= 4);
  if (inHighBand) return true;
  var inLowBand = (lastPct >= 2.66 && lastPct <= 2.76) || (lastPct >= 3.66 && lastPct <= 3.76);
  if (inLowBand && closePct != null && !isNaN(closePct) && lastPct === closePct) return true;
  return false;
}

var TARGET_URL = "https://s3.optionschool24.com/last?type=3";

async function fetchRawData() {
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
      var dte = si(row.day_left || 0);
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
      var spread = askPrice > 0 && bidPrice > 0 ? askPrice - bidPrice : 0;

      var tradingDays = si(firstNumber(row, [
        "dey_left_actual", "day_left_actual", "days_left_actual",
        "trading_days_left", "trading_day_left", "business_days_left",
        "dey_left", "day_left_trade"
      ], 0), 0);

      var rawStatus = String(row.status_text || "") || (isCall ? (spot > strike ? "ITM" : spot < strike ? "OTM" : "ATM") : (spot < strike ? "ITM" : spot > strike ? "OTM" : "ATM"));
      var status = rawStatus.indexOf("سود") !== -1 ? "ITM" : rawStatus.indexOf("ضرر") !== -1 ? "OTM" : rawStatus.indexOf("تفاوت") !== -1 ? "ATM" : rawStatus;

      var basisLastPercent = firstNumber(row, ["basis_c_percent", "basis_percent", "basis_last_percent"], 0);
      var basisClosePercent = firstNumber(row, ["basis_pc_percent", "basis_final_percent", "basis_close_percent"], 0);

      out.push({
        name: String(row.name || ""), basis_name: String(row.basis_name || ""),
        type: isCall ? "call" : "put", strike: strike, spot: spot, price: finalPrice,
        buy_price: askPrice > 0 && askVol > 0 ? askPrice : finalPrice,
        sell_price: bidPrice > 0 && bidVol > 0 ? bidPrice : finalPrice,
        end_price: lastPrice, end_pct: lastPct, final_pct: finalPct, low: low, high: high,
        intrinsic: intrinsic, time_val: timeVal, be: be, be_diff: beDiff, strike_diff: strikeDiff,
        bs: bs, bs_diff: bsDiff, volume: volume, tvalue: tvalue, oi: oi, op_change: opChange,
        trading_days: tradingDays, dte: dte, size: size, expiry: String(row.to_date || ""),
        iv: iv, hist_vol: histVol, delta: delta, theta: theta, gamma: gamma, vega: vega, rho: rho,
        leverage: leverage, bid_price: bidPrice, bid_vol: bidVol, ask_price: askPrice, ask_vol: askVol,
        spread: spread, margin: sf(row.tazmin_3 || row.tazmin3 || row.tazmin || 0), status: status,
        basis_last_percent: basisLastPercent, basis_close_percent: basisClosePercent
      });
    } catch (e) { /* رد شدن از ردیف خراب */ }
  }
  return out;
}

function dedupeAndFlagBuyable(contracts) {
  contracts.forEach(function (c) {
    c.basis_buyable = !isStockInBuyQueue(c.basis_last_percent, c.basis_close_percent);
  });
  var map = {};
  contracts.forEach(function (c) {
    var key = c.name + "|" + c.expiry;
    if (!map[key]) { map[key] = c; return; }
    var old = map[key];
    var has = c.ask_vol > 0 || c.bid_vol > 0;
    var oldHas = old.ask_vol > 0 || old.bid_vol > 0;
    if (has && !oldHas) map[key] = c;
    else if (has && oldHas) {
      if (c.ask_vol > 0 && old.ask_vol === 0) map[key] = c;
      else if (!(c.ask_vol === 0 && old.ask_vol > 0) && c.bid_vol > old.bid_vol) map[key] = c;
    }
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

async function loadContracts() {
  var raw = await fetchRawData();
  var parsed = parseContracts(raw);
  var deduped = dedupeAndFlagBuyable(parsed);
  var calls = deduped.filter(function (c) { return c.type === "call"; });
  var puts = deduped.filter(function (c) { return c.type === "put"; });
  return { calls: calls, puts: puts, all: deduped };
}

module.exports = { loadContracts: loadContracts };
