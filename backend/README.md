# Option Hunter Backend (نسخه‌ی به‌روزشده)

این پوشه نسخه‌ی اصلاح‌شده‌ی بک‌اند Express + Mongoose شماست که باید جایگزین سورس فعلی روی
مخزن گیت‌هاب / سرویس Render شود (همون ساختار قبلی: `db.js`, `index.js`, `models/`, `routes/`, `services/`).

## تغییرات مهم نسبت به نسخه‌ی قبلی

1. **حذف کف‌های ثابت شکار موقعیت** (`shockFloor`, `profitFloor`) — فقط نرخ روزانه باقی مانده:
   `requiredShock = dte × shockRate`, `requiredProfit = dte × profitRate`.
2. **شوک واقعی (actual shock)**: برای هر موقعیت (به‌جز کانورژن/باکس) با اسکن + تنصیف بازه
   روی تابع payoff، نزدیک‌ترین درصد شوک صعودی و نزولی که باعث ضرر می‌شود پیدا می‌شود.
   شرط قبولی: `min(shockUp, shockDown) ≥ requiredShock`.
3. همه‌ی ۱۱ استراتژی (از جمله `strangleSell`, `callspreadbear`, `putspreadbull` که قبلاً
   جا افتاده بودند) در شکار موقعیت بررسی می‌شوند.
4. **تنظیمات تلگرام جدید**: `huntTopNUnlimited` (بدون محدودیت تعداد ارسال)،
   `huntCooldownForever` (فقط یک‌بار برای همیشه اطلاع بده)، و `huntNotifyEnabled` (فعال/غیرفعال
   بودن اطلاع‌رسانی تلگرام به‌ازای هر استراتژی، مستقل از نمایش آن در تب «شکار موقعیت‌ها»).
5. **قانون جدید تشخیص صف خرید سهم پایه** در `services/dataSource.js`.
6. **رفع گلوگاه دیتابیس**: `notifyGate.js` به‌جای N کوئری جدا برای هر ردیف، یک کوئری دسته‌ای
   (`$in`) + یک `bulkWrite` انجام می‌دهد.
7. فایل `services/testTelegram.js` حذف شد (فقط برای تست دستی بود).

## استقرار

```bash
cd backend
npm install
cp .env.example .env   # و مقادیر واقعی را پر کنید
npm start
```

متغیرهای محیطی لازم: `MONGODB_URI`, `PORT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `API_KEY`.

بعد از استقرار، مقدار `API_KEY` را دقیقاً همان‌طور که در Render تنظیم کرده‌اید در فایل فرانت‌اند
(`CONFIG.API_KEY` در ابتدای اسکریپت) قرار دهید — این باگ در نسخه‌ی قبلی باعث خطای 401 روی
ذخیره‌ی تنظیمات می‌شد.

هیچ migration دستی روی داده‌های قدیمی Mongo لازم نیست؛ فیلدهای حذف‌شده (`shockFloor`,
`profitFloor`) در اسناد قدیمی نادیده گرفته می‌شوند و فیلدهای جدید هنگام اولین خواندن/نوشتن
با مقدار پیش‌فرض ساخته می‌شوند.
