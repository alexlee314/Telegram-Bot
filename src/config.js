const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function loadConfig() {
  loadDotEnv();
  const raw = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf8")
  );
  return {
    pollSeconds: Number(raw.pollSeconds) || 15,
    language: raw.language || "en",
    order: raw.order || "recent",
    category: raw.category || "",
    query: raw.query || "",
    skills: raw.skills || "",
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    maxPages: Number(raw.maxPages) || 1,
    seedPages: Number(raw.seedPages) || 6,
    maxAgeHours: Number(raw.maxAgeHours) || 3,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  };
}

module.exports = { ROOT, loadConfig };
