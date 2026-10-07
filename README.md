# OptionStrategist

سیستم استراتژی آپشن روی زنجیره غنی‌شده OptionHunter.

## معماری

OptionHunter (3000) <-- proxy -- OptionStrategist (3001)
        ^                              |
        |                              v
Collector (5000)                    Frontend

## اتصال به داده

OptionStrategist داده را از طریق proxy به OptionHunter می‌گیرد:

var TARGET_URL = process.env.OPTIONS_CHAIN_PROXY_URL
              || "https://s3.optionschool24.com/last?type=3";

در .env:
OPTIONS_CHAIN_PROXY_URL=http://127.0.0.1:3000/api/options-chain

نکته مهم: فایل .env باید در ریشه پروژه باشد
(~/apps/OptionStrategiest/.env) تا dotenv آن را پیدا کند.

## استراتژی‌ها

- cc: کاورد کال
- mp: مرید پوت
- co: کلار
- cv: کانورژن
- strangle: استرانگل خرید
- strangleSell: استرانگل فروش
- callspread: کال اسپرد صعودی
- callspreadbear: کال اسپرد نزولی
- putspread: پوت اسپرد نزولی
- putspreadbull: پوت اسپرد صعودی
- box: خرید باکس
- boxSell: فروش باکس

## تنظیمات کلیدی

- shockRate / shockFloor: نرخ/کف نوسان روزانه
- shockMode: rate | floor | both
- profitRate / profitFloor
- profitMode: rate | floor | both
- dteMin / dteMax
- huntOnlyBuyable
- huntCooldownMinutes
- manualHolidays

## استقرار

cd ~/apps/OptionStrategiest
git pull
pm2 restart optionstrategist --update-env

## تست

curl -s http://127.0.0.1:3001/api/status
curl -s http://127.0.0.1:3001/api/watch | head -c 300
curl -s http://127.0.0.1:3001/api/strategy/cc | head -c 300
curl -s http://127.0.0.1:3001/api/health

## لاگ‌ها

pm2 logs optionstrategiest --lines 50 --nostream
pm2 flush optionstrategiest

## زمان‌بندی

- watcher: هر 30 ثانیه
- internal tick: فقط در ساعات بازار (9:00-12:35)
- cycle: هر بار تغییر API

## عیب‌یابی

خطای HTTP 404:
- OptionHunter روی 3000 بالا نیست
- OPTIONS_CHAIN_PROXY_URL تنظیم نشده
- .env در مسیر اشتباه

خطای داده نامعتبر دریافت شد:
- پاسخ OptionHunter کمتر از 10 ردیف
- cache خالی و warm-up کامل نشده
- TIMEOUT کمتر از زمان compute

خطای Unauthorized (تلگرام):
- توکن Bot اشتباه
- Chat ID نامعتبر

خالی بودن watch/huntCount:
- پارس فیلدهای TSETMC در dataSource.js ناموفق
- بررسی spot, strike, dte

## تغییرات Phase 2

- dataSource.js: پارس هوشمند S, emal, day_left
- timeout از 15s به 120s
- basis_buyable پیش‌فرض true
- tvalue فیلتر شل‌گیری
