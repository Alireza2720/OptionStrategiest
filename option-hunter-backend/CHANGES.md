# تغییرات بک‌اند (نسخه‌ی جدید)

این پوشه نسخه‌ی کامل و به‌روزشده‌ی بک‌اند `option-hunter-backend` است. آن را جایگزین
مخزن گیت‌هاب فعلی کنید (یا فقط فایل‌های تغییریافته را جایگزین کنید) و دوباره روی
Render دیپلوی کنید. متغیرهای محیطی (`MONGODB_URI`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `API_KEY`) دست‌نخورده باقی می‌مانند.

## فایل‌هایی که تغییر کرده‌اند
- `models/Settings.js` — حذف کامل کف‌های ثابت شوک/سود؛ اضافه‌شدن تنظیمات مستقل
  برای هر ۱۱ استراتژی (`huntStrategies.<type>.{shockRate, profitRate, telegramEnabled}`)؛
  اضافه‌شدن `huntTopNUnlimited`، `huntCooldownMinutes`، `huntCooldownForever`.
- `models/Notification.js` — TTL روی فیلد جدید `expireAt` (نه `lastNotifiedAt`) تا
  حالت «فقط یک‌بار برای همیشه» درست کار کند.
- `services/dataSource.js` — منطق جدید `isStockInBuyQueue` طبق قوانین دقیق درخواستی.
- `services/huntEngine.js` — بازنویسی کامل: افزودن `strangleSell`، `callspreadbear`،
  `putspreadbull` به لیست استراتژی‌های بررسی‌شده (قبلاً جا افتاده بودند)؛ الگوریتم
  عمومی «شوک واقعی» (اسکن + تنصیف بازه روی تابع payoff هر ردیف) به‌جای فرمول ثابت؛
  کانورژن/باکس فقط بر اساس سود بررسی می‌شوند (بدون شوک).
- `services/notifyGate.js` — یک کوئری دسته‌ای (`$in`) + یک `bulkWrite` به‌جای N
  کوئری جداگانه؛ پشتیبانی از حالت cooldown همیشگی.
- `services/messageFormat.js` — محتوای پیام تلگرام بازطراحی شد (سناریوهای واقعی،
  شوک مثبت/منفی واقعی، بدون کانورژن/باکس نیازی به سطر شوک ندارند).
- `services/cycleRunner.js` — فیلتر تلگرام بر اساس `telegram_enabled` هر ردیف و
  پشتیبانی از «بدون محدودیت» / «cooldown همیشگی».
- `routes/api.js` — لیست فیلدهای مجاز تنظیمات به‌روزرسانی شد.

## فایل حذف‌شده
- `services/testTelegram.js` (فقط برای تست دستی بود، در پروداکشن استفاده نمی‌شد).

## نکته‌ی مهم درباره‌ی داده‌های قدیمی در Mongo Atlas
سند `Settings` قبلی شما فیلدهای `huntCat1`/`huntCat2` را دارد که دیگر استفاده
نمی‌شوند (بی‌ضرر باقی می‌مانند). به محض اولین خواندن سند در برنامه‌ی جدید،
Mongoose مقادیر پیش‌فرض `huntStrategies` را برای فیلدهای جدید اعمال می‌کند و با
اولین ذخیره‌ی تنظیمات از فرانت، به‌طور کامل در دیتابیس نوشته می‌شود.
