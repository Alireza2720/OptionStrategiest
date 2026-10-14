"use strict";

// ساعت رسمی ایران از فروردین ۱۴۰۱ همیشه ثابت UTC+3:30 است (بدون تغییر ساعت تابستانی/زمستانی)
var MARKET_TZ_OFFSET_MIN = 3.5 * 60;
var MARKET_OPEN_MIN = 9 * 60;         // 09:00
var MARKET_CLOSE_MIN = 12 * 60 + 30;  // 12:30
// بر اساس Date.getUTCDay(): یکشنبه=0, دوشنبه=1, سه‌شنبه=2, چهارشنبه=3, پنجشنبه=4, جمعه=5, شنبه=6
var MARKET_DAYS = [0, 1, 2, 3, 6];

function toTehranDate(date) {
  var d = date || new Date();
  var utcMs = d.getTime() + d.getTimezoneOffset() * 60000; // نرمال‌سازی به UTC واقعی
  return new Date(utcMs + MARKET_TZ_OFFSET_MIN * 60000);
}

function pad2(v) { return v < 10 ? "0" + v : String(v); }

// کلید روز به وقت تهران، مثلاً "2024-03-21" (بر مبنای تقویم میلادی، فقط برای مقایسه یکتای روز کافی است)
function todayKeyTehran(date) {
  var t = toTehranDate(date);
  return t.getUTCFullYear() + "-" + pad2(t.getUTCMonth() + 1) + "-" + pad2(t.getUTCDate());
}

function isMarketOpen(date, holidays) {
  var t = toTehranDate(date);
  var day = t.getUTCDay();
  if (MARKET_DAYS.indexOf(day) === -1) return false;
  var minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (minutes < MARKET_OPEN_MIN || minutes > MARKET_CLOSE_MIN) return false;
  if (holidays && holidays.length > 0) {
    if (holidays.indexOf(todayKeyTehran(date)) !== -1) return false;
  }
  return true;
}

// حذف تاریخ‌های قدیمی‌تر از ۷ روز از لیست تعطیلات دستی (برای جلوگیری از رشد بی‌رویه)
function pruneOldHolidays(holidays, date) {
  if (!holidays || holidays.length === 0) return [];
  var cutoff = new Date((date || new Date()).getTime() - 7 * 24 * 3600 * 1000);
  var cutoffKey = todayKeyTehran(cutoff);
  return holidays.filter(function (k) { return k >= cutoffKey; });
}

module.exports = {
  isMarketOpen: isMarketOpen,
  toTehranDate: toTehranDate,
  todayKeyTehran: todayKeyTehran,
  pruneOldHolidays: pruneOldHolidays
};