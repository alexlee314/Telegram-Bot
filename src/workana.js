const { spawn } = require("child_process");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CURL = process.platform === "win32" ? "curl.exe" : "curl";

function decodeEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const titled = String(html).match(/title="([^"]+)"/);
  if (titled) return decodeEntities(titled[1]);
  return stripTags(html);
}

function extractCountry(html) {
  if (!html) return "";
  const titled = String(html).match(/title="([^"]+)"/);
  if (titled) return decodeEntities(titled[1]);
  return stripTags(html);
}

function extractCountryCode(html) {
  const match = String(html || "").match(/flag-([a-z]{2})/i);
  return match ? match[1].toLowerCase() : "";
}

function extractResults(html) {
  const key = ":results-initials=";
  const start = html.indexOf(key);
  if (start < 0) {
    throw new Error("Workana page layout changed: job list not found");
  }
  const quote = html[start + key.length];
  if (quote !== "'" && quote !== '"') {
    throw new Error("Workana page layout changed: unexpected job payload");
  }
  let i = start + key.length + 1;
  let raw = "";
  while (i < html.length && html[i] !== quote) {
    raw += html[i];
    i += 1;
  }
  return JSON.parse(decodeEntities(raw));
}

function normalizeJob(raw) {
  const slug = raw.slug;
  return {
    slug,
    title: extractTitle(raw.title || ""),
    url: `https://www.workana.com/job/${slug}`,
    description: stripTags(raw.description || ""),
    budget: raw.budget || "",
    postedDate: raw.postedDate || "",
    publishedDate: raw.publishedDate || "",
    bids: stripTags(raw.totalBids || ""),
    authorName: raw.authorName || "",
    country: extractCountry(raw.country || ""),
    countryCode: extractCountryCode(raw.country || ""),
    paymentVerified: Boolean(raw.hasVerifiedPaymentMethod),
    rating: raw.rating && raw.rating.value ? String(raw.rating.value) : "",
    isHourly: Boolean(raw.isHourly),
    isUrgent: Boolean(raw.isUrgent),
    skills: (raw.skills || []).map((s) => s.anchorText).filter(Boolean),
  };
}

function buildUrl(config, page) {
  const url = new URL("https://www.workana.com/jobs");
  url.searchParams.set("language", config.language);
  url.searchParams.set("order", config.order);
  if (config.category) url.searchParams.set("category", config.category);
  if (config.query) url.searchParams.set("query", config.query);
  if (config.skills) url.searchParams.set("skills", config.skills);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function runCurl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CURL, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim();
        if (code === 5) {
          reject(
            new Error(
              "Could not resolve proxy host. Use http://USER:PASS@HOST:PORT (not HOST:PORT:USER:PASS)."
            )
          );
          return;
        }
        reject(new Error(detail || `${CURL} exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function buildProxyUrl(host, port, user, pass) {
  if (user) {
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass || "")}@${host}:${port}`;
  }
  return `http://${host}:${port}`;
}

function normalizeProxyUrl(raw) {
  const value = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  if (!value) return "";
  if (
    /^(https?|socks5h?):\/\/[^/@]+@[^/@]+:\d+\/?$/i.test(value)
  ) {
    return value.replace(/\/$/, "");
  }
  const stripped = value.replace(/^(https?|socks5h?):\/\//i, "");
  const parts = stripped.split(":");
  if (parts.length === 4 && /^\d+$/.test(parts[1])) {
    const [host, port, user, pass] = parts;
    return buildProxyUrl(host, port, user, pass);
  }
  return value;
}

function getProxyUrl() {
  if (process.env.PROXY_URL) return normalizeProxyUrl(process.env.PROXY_URL);
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  if (!host || !port) return "";
  return buildProxyUrl(host, port, process.env.PROXY_USER, process.env.PROXY_PASS);
}

async function fetchHtml(url) {
  const proxy = getProxyUrl();
  const args = [
    "-sSL",
    "--compressed",
    "-A",
    UA,
    "-H",
    "Accept: text/html,application/xhtml+xml",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-b",
    "appcookie[user_locale]=en_US",
    "--max-time",
    "45",
  ];
  if (proxy) args.push("-x", proxy);
  args.push(url);
  const html = await runCurl(args);
  if (html.includes("Just a moment...") || html.includes("cf-mitigated")) {
    throw new Error("Workana blocked the request (Cloudflare challenge)");
  }
  return html;
}

async function fetchPage(config, page) {
  const url = buildUrl(config, page);
  const html = await fetchHtml(url);
  const payload = extractResults(html);
  return (payload.results || []).map(normalizeJob);
}

function matchesKeywords(job, keywords) {
  if (!keywords.length) return true;
  const haystack = [job.title, job.description, job.skills.join(" ")]
    .join(" ")
    .toLowerCase();
  return keywords.some((word) => haystack.includes(String(word).toLowerCase()));
}

function postedHoursAgo(job) {
  const text = `${job.postedDate} ${job.publishedDate}`.toLowerCase();
  if (!text.trim()) return Number.POSITIVE_INFINITY;
  if (
    /just now|seconds? ago|instants?|un momento|hace unos|há pouco|há segundos/.test(
      text
    )
  ) {
    return 0;
  }
  if (
    /almost an hour|an hour ago|hace una hora|há uma hora/.test(text)
  ) {
    return 1;
  }
  if (/a few minutes|hace minutos|há minutos|a minute ago/.test(text)) {
    return 0.1;
  }
  if (/yesterday|ayer|ontem/.test(text)) return 24;
  if (/\b(\d+)\s*(week|semanas?)\b/.test(text)) {
    return Number(text.match(/\b(\d+)\s*(week|semanas?)\b/)[1]) * 24 * 7;
  }
  if (/\b(\d+)\s*(month|meses)\b/.test(text)) {
    return Number(text.match(/\b(\d+)\s*(month|meses)\b/)[1]) * 24 * 30;
  }
  if (/\b(\d+)\s*(days?|días?|dias)\b/.test(text)) {
    return Number(text.match(/\b(\d+)\s*(days?|días?|dias)\b/)[1]) * 24;
  }
  if (/\b(\d+)\s*(hours?|horas?)\b/.test(text)) {
    return Number(text.match(/\b(\d+)\s*(hours?|horas?)\b/)[1]);
  }
  if (/\b(\d+)\s*(minutes?|minutos?)\b/.test(text)) {
    return Number(text.match(/\b(\d+)\s*(minutes?|minutos?)\b/)[1]) / 60;
  }
  return Number.POSITIVE_INFINITY;
}

function isFresh(job, maxAgeHours) {
  return postedHoursAgo(job) <= maxAgeHours;
}

const FLAG_COUNTRIES = {
  ar: "Argentina",
  au: "Australia",
  bo: "Bolivia",
  br: "Brazil",
  ca: "Canada",
  cl: "Chile",
  co: "Colombia",
  cr: "Costa Rica",
  de: "Germany",
  do: "Dominican Republic",
  ec: "Ecuador",
  es: "Spain",
  fr: "France",
  gb: "United Kingdom",
  gt: "Guatemala",
  hn: "Honduras",
  in: "India",
  it: "Italy",
  mx: "Mexico",
  ni: "Nicaragua",
  pa: "Panama",
  pe: "Peru",
  ph: "Philippines",
  pt: "Portugal",
  py: "Paraguay",
  sv: "El Salvador",
  us: "United States",
  uy: "Uruguay",
  ve: "Venezuela",
};

function extractCount(html, labels) {
  const pattern = new RegExp(
    `<p class="h4">\\s*(\\d+)\\s*</p>\\s*<p>\\s*(?:${labels})\\s*</p>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? Number(match[1]) : null;
}

function extractFlagCountry(html) {
  const match = html.match(/class="flag flag-([a-z]{2})"/i);
  if (!match) return "";
  const code = match[1].toLowerCase();
  return FLAG_COUNTRIES[code] || code.toUpperCase();
}

function extractMemberSince(html) {
  const match = html.match(
    /Member since:\s*([^<]+)|Miembro desde:\s*([^<]+)|Membro desde:\s*([^<]+)/i
  );
  if (!match) return "";
  return (match[1] || match[2] || match[3] || "").replace(/\s+/g, " ").trim();
}

async function fetchJobDetails(job) {
  const html = await fetchHtml(job.url);
  const jobsPosted = extractCount(
    html,
    "Published projects|Proyectos publicados|Projetos publicados"
  );
  const jobsPaid = extractCount(
    html,
    "Projects paid|Proyectos pagados|Projetos pagos"
  );
  const pageCountry = extractFlagCountry(html);
  const pageCountryCode = extractCountryCode(html);
  const pageTitle = html.match(
    /<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i
  );
  const paymentOnPage = /payment verified|pago verificado|pagamento verificado/i.test(
    html
  );

  return {
    ...job,
    title: pageTitle ? stripTags(pageTitle[1]) : job.title,
    url: `https://www.workana.com/job/${job.slug}`,
    country: pageCountry || job.country || "Unknown",
    countryCode: pageCountryCode || job.countryCode || "",
    memberSince: extractMemberSince(html),
    paymentVerified: job.paymentVerified || paymentOnPage,
    jobsPosted,
    jobsPaid,
  };
}

async function fetchJobs(config, pageCount) {
  const pages = pageCount || config.maxPages;
  const seen = new Set();
  const jobs = [];
  for (let page = 1; page <= pages; page += 1) {
    const pageJobs = await fetchPage(config, page);
    for (const job of pageJobs) {
      if (!job.slug || seen.has(job.slug)) continue;
      if (!matchesKeywords(job, config.keywords)) continue;
      seen.add(job.slug);
      jobs.push(job);
    }
  }
  return jobs;
}

function newestPostedLabel(jobs) {
  if (!jobs.length) return "none";
  let best = jobs[0];
  let bestHours = postedHoursAgo(best);
  for (const job of jobs) {
    const hours = postedHoursAgo(job);
    if (hours < bestHours) {
      best = job;
      bestHours = hours;
    }
  }
  return best.postedDate || "unknown age";
}

module.exports = { fetchJobs, fetchJobDetails, isFresh, newestPostedLabel };
