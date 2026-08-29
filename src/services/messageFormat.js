"use strict";

var LABELS = {
  cc: "کاوردکال", mp: "مریدپوت", co: "کلار", cv: "کانورژن",
  strangle: "استرانگل خرید", callspread: "کال اسپرد صعودی",
  putspread: "پوت اسپرد نزولی", box: "باکس"
};

function fmt(v, d) {
  if (v == null || isNaN(v)) return "—";
  if (d === undefined) d = 1;
  return Number(v).toFixed(d);
}

function formatRow(r) {
  return "🎯 <b>" + (LABELS[r.strategy_type] || r.strategy_type) + "</b>\n" +
    "موقعیت: <code>" + r.primary_name + "</code>\n" +
    "سهم پایه: " + r.basis_name + "  |  سررسید: " + r.expiry + " (" + r.dte + " روز)\n" +
    "بازده بدون تغییر قیمت: " + fmt(r.roi_zero) + "٪\n" +
    "شوک لازم: ±" + fmt(r.required_shock) + "٪  |  آستانه سود لازم: " + fmt(r.required_profit) + "٪\n" +
    "بدترین حالت: " + fmt(r.worst_case_roi) + "٪  |  حاشیه اطمینان: " + fmt(r.safety_margin) + "٪\n" +
    (r.basis_buyable === false ? "⚠️ سهم پایه در صف خرید است" : "✅ سهم پایه قابل خرید است");
}

function formatBatch(rows) {
  var header = "🔔 " + rows.length + " موقعیت جدید در «شکار موقعیت‌ها» پیدا شد:\n\n";
  var body = rows.map(formatRow).join("\n\n———\n\n");
  return header + body;
}

module.exports = { formatRow: formatRow, formatBatch: formatBatch };