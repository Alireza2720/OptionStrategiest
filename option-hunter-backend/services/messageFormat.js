"use strict";

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

function formatRow(r) {
  var lines = [];
  lines.push("🎯 <b>" + (LABELS[r.strategy_type] || r.strategy_type) + "</b>");
  lines.push("موقعیت: <code>" + r.primary_name + "</code>");
  lines.push("سهم پایه: " + r.basis_name + "  |  سررسید: " + r.expiry + " (" + r.dte + " روز)");

  (r.rawScenarioList || []).forEach(function (s) {
    if (s.value == null || isNaN(s.value)) return;
    var lbl = r.is_shockless
      ? "بازده (ثابت، مستقل از قیمت)"
      : ("بازده واقعی در " + (s.pct > 0 ? "+" : "") + fmt(s.pct, 1) + "٪ تغییر سهم");
    lines.push(lbl + ": " + fmt(s.value) + "٪");
  });

  if (!r.is_shockless) {
    lines.push("حداکثر شوک مثبت قابل‌تحمل: " + (r.actual_shock_up == null ? "بدون محدودیت" : "+" + fmt(r.actual_shock_up) + "٪"));
    lines.push("حداکثر شوک منفی قابل‌تحمل: " + (r.actual_shock_down == null ? "بدون محدودیت" : "-" + fmt(r.actual_shock_down) + "٪"));
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
