const fs = require("fs");
const path = require("path");
const { ROOT } = require("./config");

const dataDir = process.env.DATA_DIR || path.join(ROOT, "data");
const FILE = path.join(dataDir, "seen.json");

function loadSeen() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return new Set(data.slugs || []);
  } catch {
    return new Set();
  }
}

const MAX_SEEN = 3000;

function saveSeen(seen) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const slugs = [...seen];
  const trimmed = slugs.length > MAX_SEEN ? slugs.slice(-MAX_SEEN) : slugs;
  if (trimmed.length !== slugs.length) {
    seen.clear();
    for (const slug of trimmed) seen.add(slug);
  }
  fs.writeFileSync(FILE, JSON.stringify({ slugs: trimmed }, null, 2), "utf8");
}

module.exports = { loadSeen, saveSeen };
