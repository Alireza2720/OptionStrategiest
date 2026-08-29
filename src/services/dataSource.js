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

function isStockInBuyQueue(lastPct, closePct) {
  if (lastPct == null || isNaN(lastPct) || lastPct < 2.66) return false;
  if (lastPct > 3.01 && lastPct < 3.74) return false;
  if (lastPct >= 2.89) return true;
  return lastPct >= 2.66 && closePct != null && !isNaN(closePct) && lastPct === closePct;
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
      var tvalue = sf(row.Tvalue || 0);
      if (tvalue < 100000) continue;

      var bPrices = parsePriceVol(row.b_price);
      var bVolumes = parsePriceVol(row.b_volume);
      var sPrices = parsePriceVol(row.s_price);
      var sVolumes = parsePriceVol(row.s_volume);
      var bidPrice = bPrices[0] || 0;
      var bidVol = bVolumes[0] || 0;
      var askPrice = sPrices[0] || 0;
      var askVol = sVolumes[0] || 0;

      var basisLastPercent = firstNumber(row, ["basis_c_percent", "basis_percent", "basis_last_percent"], 0);
      var basisClosePercent = firstNumber(row, ["basis_pc_percent", "basis_final_percent", "basis_close_percent"], 0);

      out.push({
        name: String(row.name || ""),
        basis_name: String(row.basis_name || ""),
        type: isCall ? "call" : "put",
        strike: strike,
        spot: spot,
        price: finalPrice,
        buy_price: askPrice > 0 && askVol > 0 ? askPrice : finalPrice,
        sell_price: bidPrice > 0 && bidVol > 0 ? bidPrice : finalPrice,
        dte: dte,
        size: size,
        expiry: String(row.to_date || ""),
        bid_price: bidPrice,
        bid_vol: bidVol,
        ask_price: askPrice,
        ask_vol: askVol,
        tvalue: tvalue,
        margin: sf(row.tazmin_3 || row.tazmin3 || row.tazmin || 0),
        basis_last_percent: basisLastPercent,
        basis_close_percent: basisClosePercent
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