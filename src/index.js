const http = require("http");
const { loadConfig } = require("./config");
const { fetchJobs, fetchJobDetails, isFresh, newestPostedLabel } = require("./workana");
const { loadSeen, saveSeen } = require("./seen");
const { alertNewJob } = require("./notify");

const once = process.argv.includes("--once");

function stamp(message) {
  const now = new Date().toLocaleTimeString();
  console.log(`[${now}] ${message}`);
}

async function poll(config, seen, isFirst) {
  const jobs = await fetchJobs(
    config,
    isFirst && seen.size === 0 ? config.seedPages : config.maxPages
  );
  if (isFirst && seen.size === 0) {
    for (const job of jobs) seen.add(job.slug);
    saveSeen(seen);
    stamp(`Watching ${jobs.length} current jobs. Alerts start on the next new post.`);
    return;
  }

  const unknown = jobs.filter((job) => !seen.has(job.slug));
  const fresh = unknown.filter((job) => isFresh(job, config.maxAgeHours));
  if (unknown.length && !fresh.length) {
    stamp(
      `Saw ${unknown.length} unseen listing(s), but none were posted within ${config.maxAgeHours}h.`
    );
  }
  for (const job of jobs) seen.add(job.slug);
  for (const job of fresh) {
    let detailed = job;
    try {
      detailed = await fetchJobDetails(job);
    } catch (err) {
      stamp(`Could not load job page for ${job.slug}: ${err.message}`);
    }
    await alertNewJob(detailed, config);
  }
  if (unknown.length) saveSeen(seen);
  stamp(
    fresh.length
      ? `Alerted ${fresh.length} new job(s). Tracking ${seen.size} listings.`
      : `No new jobs. Checked ${jobs.length} listings. Newest IT listing: ${newestPostedLabel(jobs)}`
  );
}

function startHealthServer() {
  const port = process.env.PORT;
  if (!port) return;
  const server = http.createServer((req, res) => {
    const ok = req.url === "/" || req.url === "/health";
    res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, service: "jobalertbot" }));
  });
  server.listen(Number(port), "0.0.0.0", () => {
    stamp(`Health server listening on port ${port}`);
  });
}

async function main() {
  const config = loadConfig();
  startHealthServer();
  const seen = loadSeen();
  const filters = [
    config.category && `category=${config.category}`,
    config.query && `query=${config.query}`,
    config.skills && `skills=${config.skills}`,
    config.keywords.length && `keywords=${config.keywords.join(",")}`,
  ].filter(Boolean);

  stamp(
    `Checking Workana every ${config.pollSeconds}s` +
      (filters.length ? ` (${filters.join(", ")})` : " (all recent jobs)")
  );
  if (config.telegramBotToken && config.telegramChatId) {
    stamp("Telegram alerts are enabled.");
  } else {
    stamp("Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable Telegram alerts.");
  }

  let first = seen.size === 0;
  await poll(config, seen, first);
  first = false;
  if (once) return;

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await poll(config, seen, false);
    } catch (err) {
      stamp(`Check failed: ${err.message}. Retrying...`);
    } finally {
      busy = false;
    }
  };

  setInterval(tick, config.pollSeconds * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
