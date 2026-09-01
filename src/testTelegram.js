"use strict";
require("dotenv").config();
var { sendLongMessage } = require("./services/telegram");

async function main() {
  var token = process.env.TELEGRAM_BOT_TOKEN;
  var chatId = process.env.TELEGRAM_CHAT_ID;
  console.log("Token موجود است:", !!token);
  console.log("Chat ID:", chatId);

  await sendLongMessage(token, chatId, "✅ این یک پیام تستی از سرور option-hunter است.");
  console.log("پیام با موفقیت ارسال شد!");
}

main().catch(function (err) {
  console.error("❌ خطا در ارسال:", err.message);
});