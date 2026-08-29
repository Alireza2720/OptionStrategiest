"use strict";

async function sendTelegramMessage(token, chatId, text) {
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });
  var json = await res.json().catch(function () { return {}; });
  if (!res.ok || !json.ok) {
    throw new Error("Telegram error: " + (json.description || res.status));
  }
  return json;
}

// تلگرام هر پیام را حداکثر ۴۰۹۶ کاراکتر می‌پذیرد؛ اگر طولانی بود تکه‌تکه می‌فرستیم
async function sendLongMessage(token, chatId, text) {
  var LIMIT = 3500;
  if (text.length <= LIMIT) {
    return sendTelegramMessage(token, chatId, text);
  }
  var parts = [];
  var lines = text.split("\n");
  var cur = "";
  lines.forEach(function (line) {
    if ((cur + line + "\n").length > LIMIT) {
      parts.push(cur);
      cur = "";
    }
    cur += line + "\n";
  });
  if (cur) parts.push(cur);
  for (var i = 0; i < parts.length; i++) {
    await sendTelegramMessage(token, chatId, parts[i]);
  }
}

module.exports = { sendLongMessage: sendLongMessage };