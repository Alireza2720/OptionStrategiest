"use strict";
var { SHOCK_INF } = require("./huntEngine");

var LABELS = {
  cc: "کاوردکال", mp: "مریدپوت", co: "کلار", cv: "کانورژن",
  strangle: "استرانگل خرید", strangleSell: "استرانگل فروش",
  callspread: "کال اسپرد صعودی", callspreadbear: "کال اسپرد نزولی",
  putspread: "پوت اسپرد نزولی", putspreadbull: "پوت اسپرد صعودی",
  box: "باکس"
};

function fmt(v, d) {
  if (v == null || isNaN(v)) return "—";
  if (d === undefined) d = 1;
  return Number(v).toFixed(d);
}

function fmtShock(v) {
  if (v == null) return "—";
  if (v >= SHOCK_INF) return "نامحدود";
  return fmt(v) + "٪";
}

// همه‌ی مقادیر واقعی (غیرتعدیل‌شده) سناریوهای درصدی این ردیف را (بدون نال‌ها) برمی‌گرداند
function scenarioLines(r, steps) {
  var raw = r.scenariosRaw || [];
  var lines = [];
  (steps || []).forEach(function (step, i) {
    var v = raw[i];
    if (v == null || isNaN(v)) return;
    lines.push((step > 0 ? "+" : "") + fmt(step, 1) + "%: " + fmt(v) + "٪");
  });
  return lines;
}

function formatRow(r, steps) {
  var lines = [];
  lines.push("🎯 <b>" + (LABELS[r.strategy_type] || r.strategy_type) + "</b>");
  lines.push("موقعیت: <code>" + r.primary_name + "</code>");
  lines.push("سهم پایه: " + r.basis_name + "  |  سررسید: " + r.expiry + " (" + r.dte + " روز)");

  var scen = scenarioLines(r, steps);
  if (scen.length) lines.push("بازده واقعی سناریوها: " + scen.join("، "));

  if (r.required_shock != null) {
    lines.push("حداکثر شوک صعودی قابل تحمل: " + fmtShock(r.actual_shock_up));
    lines.push("حداکثر شوک نزولی قابل تحمل: " + fmtShock(r.actual_shock_down));
  }

  lines.push(r.basis_buyable === false ? "⚠️ سهم پایه در صف خرید است" : "✅ سهم پایه قابل خرید است");
  return lines.join("\n");
}

function formatBatch(rows, steps) {
  var header = "🔔 " + rows.length + " موقعیت جدید در «شکار موقعیت‌ها» پیدا شد:\n\n";
  var body = rows.map(function (r) { return formatRow(r, steps); }).join("\n\n———\n\n");
  return header + body;
}

module.exports = { formatRow: formatRow, formatBatch: formatBatch };
