"use strict";

var LABELS = {
  cc: "کاوردکال", mp: "مریدپوت", co: "کلار", cv: "کانورژن",
  strangle: "استرانگل خرید", strangleSell: "استرانگل فروش",
  callspread: "کال اسپرد صعودی", callspreadbear: "کال اسپرد نزولی",
  putspread: "پوت اسپرد نزولی", putspreadbull: "پوت اسپرد صعودی",
  box: "باکس"
};
var NO_SHOCK_TYPES = { cv: true, box: true };

function fmt(v, d) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 99999) return "∞";
  if (d === undefined) d = 1;
  return Number(v).toFixed(d);
}

function formatRow(r) {
  var lines = [];
  lines.push("🎯 <b>" + (LABELS[r.strategy_type] || r.strategy_type) + "</b>");
  lines.push("موقعیت: <code>" + r.primary_name + "</code>");
  lines.push("سهم پایه: " + r.basis_name + "  |  سررسید: " + r.expiry + " (" + r.dte + " روز)");

  var scenRaw = r.scenariosRaw || [];
  if (NO_SHOCK_TYPES[r.strategy_type]) {
    var val = scenRaw.find(function (v) { return v != null; });
    lines.push("بازده (ثابت): " + fmt(val) + "٪");
  } else {
    var parts = scenRaw.map(function (v) { return v == null ? null : fmt(v) + "٪"; }).filter(Boolean);
    lines.push("سناریوهای واقعی: " + parts.join(" | "));
    lines.push("حداکثر شوک مثبت مجاز: " + fmt(r.actual_shock_up) + "٪  |  حداکثر شوک منفی مجاز: " + fmt(r.actual_shock_down) + "٪");
  }

  lines.push(r.basis_buyable === false ? "⚠️ سهم پایه در صف خرید است" : "✅ سهم پایه قابل خرید است");
  return lines.join("\n");
}

function formatBatch(rows) {
  var header = "🔔 " + rows.length + " موقعیت جدید در «شکار موقعیت‌ها» پیدا شد:\n\n";
  var body = rows.map(formatRow).join("\n\n———\n\n");
  return header + body;
}

module.exports = { formatRow: formatRow, formatBatch: formatBatch };