function countLabel(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function flagEmoji(code) {
  if (!code || !/^[a-z]{2}$/i.test(code)) return "";
  const base = 0x1f1e6;
  const cc = code.toLowerCase();
  return String.fromCodePoint(
    base + cc.charCodeAt(0) - 97,
    base + cc.charCodeAt(1) - 97
  );
}

function skillLine(job) {
  const skills = job.skills || [];
  if (!skills.length) return "";
  if (skills.length <= 5) return skills.join(", ");
  return `${skills.slice(0, 5).join(", ")} (+${skills.length - 5} more)`;
}

function bidLine(job) {
  const raw = String(job.bids || "").replace(/^[^\d]*/, "");
  const n = raw.match(/\d+/);
  if (n) return `${n[0]} bids`;
  return job.bids || "0 bids";
}

function ratingLine(job) {
  if (!job.rating || Number(job.rating) <= 0) return "";
  const value = Number(job.rating).toFixed(1);
  return `⭐ ${value}/5.0`;
}

function twoColumns(items) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    rows.push(right ? `${left}    ${right}` : left);
  }
  return rows;
}

function formatAlertHtml(job) {
  const payment = job.paymentVerified
    ? "✅ Payment Verified"
    : "❌ Payment Not Verified";
  const flag = flagEmoji(job.countryCode);
  const country = [flag, job.country || "Unknown"].filter(Boolean).join(" ");
  const skills = skillLine(job);
  const details = [
    job.authorName ? `👤 ${escapeHtml(job.authorName)}` : null,
    `🌍 ${escapeHtml(country)}`,
    payment,
    job.memberSince ? `🗓 ${escapeHtml(job.memberSince)}` : null,
    `📁 ${countLabel(job.jobsPosted)} posted`,
    `💳 ${countLabel(job.jobsPaid)} paid`,
    job.postedDate ? `📅 ${escapeHtml(job.postedDate)}` : null,
    job.budget ? `💰 ${escapeHtml(job.budget)}` : null,
    `📊 ${escapeHtml(bidLine(job))}`,
    ratingLine(job),
  ].filter(Boolean);
  if (skills) details.push(`🛠 ${escapeHtml(skills)}`);

  return [`<b>${escapeHtml(job.title)}</b>`, ...twoColumns(details)].join("\n");
}

function formatAlert(job) {
  return formatAlertHtml(job)
    .replace(/<b>|<\/b>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function sendTelegram(token, chatId, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram failed: ${response.status} ${body}`);
  }
}

async function telegram(job, token, chatId) {
  if (!token || !chatId) {
    throw new Error("Telegram token or chat id is missing");
  }
  const payload = {
    chat_id: chatId,
    text: formatAlertHtml(job),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔗 View Job", url: job.url },
          { text: "📋 Copy URL", copy_text: { text: job.url } },
        ],
      ],
    },
  };
  try {
    await sendTelegram(token, chatId, payload);
  } catch (err) {
    payload.reply_markup.inline_keyboard[0] = [
      { text: "🔗 View Job", url: job.url },
    ];
    await sendTelegram(token, chatId, payload);
  }
}

function consoleAlert(job) {
  console.log("--------------------------------------------------");
  console.log(formatAlert(job));
  console.log(job.url);
  console.log("--------------------------------------------------");
}

async function alertNewJob(job, config) {
  consoleAlert(job);
  try {
    await telegram(job, config.telegramBotToken, config.telegramChatId);
    console.log(`Telegram sent: ${job.title}`);
  } catch (err) {
    console.error(`Telegram alert failed: ${err.message}`);
  }
}

module.exports = { alertNewJob };
