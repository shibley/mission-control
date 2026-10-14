import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { replicationEntries, replicationQueue, type ReplicationEntry, type ReplicationQueueItem } from "./research.ts";

// Shopify apps tab. Same rule as the Research tab: everything is read from what
// already exists — the app repos, the public App Store listing, the install
// meter's own ledger, the sprint judge log, the replication log. Nothing here is
// a copy someone has to keep up to date.
//
// Apps are discovered, not listed: any ~/clawd/<dir>/shopify.app.toml (or
// ~/clawd/projects/<dir>/…) is an app, and its `handle` is the App Store slug. A
// second app shows up as a second card the moment its repo exists. The only
// per-app wiring is METERS below, for apps that have a gate instrument.

type MeterWiring = {
  /** Script that owns the gate; GATE = { installs, subscriptions, days } is read out of it. */
  script: string;
  /** JSONL the script appends one snapshot to per run. */
  ledger: string;
  /** sprint-eval-log.jsonl sprint_type prefix for this app's build fires. */
  sprintPrefix: string;
};

const METERS: Record<string, MeterWiring> = {
  "accessibility-checker-ada": {
    script: "scripts/shopify-install-meter.mjs",
    ledger: "memory/data/shopify-install-meter.jsonl",
    sprintPrefix: "build:rwa-shopify",
  },
};

export type ShopifyListing = {
  url: string;
  httpStatus: number | null;
  title: string | null;
  /** One entry per pricing plan card, e.g. "$29/month". */
  prices: string[];
  reviews: number | null;
  rating: number | null;
  launched: string | null;
  /** Set only when no good read has ever been made. */
  error: string | null;
  /** When the values above were read off a 200. null = never. */
  fetchedAt: string | null;
  /** The most recent fetch, which may have failed (429) while the values above stand. */
  lastAttempt: { at: string; status: number | null; error: string | null } | null;
};

export type ShopifyGate = {
  installs: { n: number; target: number };
  subscriptions: { n: number; target: number };
  days: number;
  /** launched + days, YYYY-MM-DD. */
  deadline: string | null;
  daysLeft: number | null;
  meterAt: string | null;
  installedNow: number | null;
  error: string | null;
};

export type ShopifySprint = { ts: string; score: number; commit: string | null; shipped: string | null };

export type ShopifyApp = {
  name: string;
  handle: string;
  repo: string;
  listing: ShopifyListing;
  gate: ShopifyGate | null;
  sprints: ShopifySprint[];
};

export type ShopifyTab = {
  apps: ShopifyApp[];
  candidates: { queue: ReplicationQueueItem[]; entries: ReplicationEntry[] };
};

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function clip(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : one;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// ---------- discovery ----------

function discoverApps(root: string): { name: string; handle: string; repo: string }[] {
  const out: { name: string; handle: string; repo: string }[] = [];
  for (const base of [root, path.join(root, "projects")]) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const toml = readText(path.join(base, d, "shopify.app.toml"));
      const handle = toml.match(/^handle\s*=\s*"([^"]+)"/m)?.[1];
      if (!handle) continue;
      const name = toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? handle;
      out.push({ name, handle, repo: path.relative(root, path.join(base, d)) });
    }
  }
  return out;
}

// ---------- public listing ----------

// The pusher runs every 5 minutes; apps.shopify.com answers 429 to an IP that
// polls it that often (measured 2026-10-13). So the page is fetched at most once
// per LISTING_TTL_MS and the last good read is kept on disk: a 429 or timeout
// shows the previous numbers with their age, never blanks.
const LISTING_TTL_MS = 6 * 3600_000;
const listingCache = (root: string) => path.join(root, "memory", "data", "shopify-listing-cache.json");

export function parseListing(url: string, html: string): Omit<ShopifyListing, "fetchedAt" | "lastAttempt"> {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  // Each plan card's heading carries its price as aria-label="$29/month".
  const prices = [...html.matchAll(/app-details-pricing-format-group[^>]*aria-label="([^"]+)"/g)].map((m) => decode(m[1]));

  // The JSON-LD block carries aggregateRating once the app has a review, and
  // omits it entirely before that — the page then says "No reviews yet".
  let reviews: number | null = null;
  let rating: number | null = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(m[1]);
      if (ld?.["@type"] !== "SoftwareApplication") continue;
      const agg = ld.aggregateRating;
      if (agg) {
        reviews = Number(agg.ratingCount ?? agg.reviewCount) || 0;
        rating = Number(agg.ratingValue) || 0;
      }
    } catch {
      // skip
    }
  }
  if (reviews === null && /No reviews yet/.test(html)) reviews = 0;

  const launchedText = html.match(/Launched[\s\S]{0,400}?([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  const launchedDate = launchedText ? new Date(`${launchedText} 12:00 UTC`) : null;
  const launched = launchedDate && !Number.isNaN(launchedDate.getTime()) ? launchedDate.toISOString().slice(0, 10) : null;

  return { url, httpStatus: 200, title: title ? decode(title.trim()) : null, prices, reviews, rating, launched, error: null };
}

function listing(root: string, handle: string): ShopifyListing {
  const url = `https://apps.shopify.com/${handle}`;
  let cache: Record<string, ShopifyListing> = {};
  try {
    cache = JSON.parse(fs.readFileSync(listingCache(root), "utf8"));
  } catch {
    // first run
  }
  const prev = cache[handle];
  const now = new Date().toISOString();
  const lastTry = prev?.lastAttempt?.at ? Date.parse(prev.lastAttempt.at) : 0;
  if (prev && Date.now() - lastTry < LISTING_TTL_MS) return prev;

  let status: number | null = null;
  let html = "";
  let err: string | null = null;
  try {
    // curl, not fetch: snapshot() is synchronous (the pusher and every page call it).
    const raw = execFileSync(
      "/usr/bin/curl",
      ["-sL", "-m", "15", "-A", "Mozilla/5.0", "-w", "\n__HTTP__%{http_code}", url],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    const at = raw.lastIndexOf("\n__HTTP__");
    html = at >= 0 ? raw.slice(0, at) : raw;
    status = at >= 0 ? Number(raw.slice(at + 9)) || null : null;
  } catch (e) {
    err = e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
  if (status !== 200) err ??= `HTTP ${status ?? "?"}`;

  const next: ShopifyListing =
    status === 200
      ? { ...parseListing(url, html), fetchedAt: now, lastAttempt: { at: now, status, error: null } }
      : prev
        ? { ...prev, lastAttempt: { at: now, status, error: err } }
        : {
            url,
            httpStatus: status,
            title: null,
            prices: [],
            reviews: null,
            rating: null,
            launched: null,
            error: err,
            fetchedAt: null,
            lastAttempt: { at: now, status, error: err },
          };
  try {
    fs.mkdirSync(path.dirname(listingCache(root)), { recursive: true });
    fs.writeFileSync(listingCache(root), JSON.stringify({ ...cache, [handle]: next }, null, 2) + "\n");
  } catch {
    // read-only filesystem (Vercel): the pushed snapshot already carries the values
  }
  return next;
}

// ---------- gate, from the meter's own ledger ----------

type LedgerGroup = { shopKind?: string; kind?: string; n?: number };

function gate(root: string, w: MeterWiring, launched: string | null): ShopifyGate {
  // The meter script is the source of truth for the targets.
  const g = readText(path.join(root, w.script)).match(
    /const GATE = \{\s*installs:\s*(\d+),\s*subscriptions:\s*(\d+),\s*days:\s*(\d+)\s*\}/
  );
  const [installsT, subsT, days] = g ? [Number(g[1]), Number(g[2]), Number(g[3])] : [25, 3, 90];

  let deadline: string | null = null;
  let daysLeft: number | null = null;
  if (launched) {
    const end = new Date(`${launched}T00:00:00Z`).getTime() + days * 86400000;
    deadline = new Date(end).toISOString().slice(0, 10);
    daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  }

  const lines = readText(path.join(root, w.ledger)).split("\n").filter(Boolean);
  const out: ShopifyGate = {
    installs: { n: 0, target: installsT },
    subscriptions: { n: 0, target: subsT },
    days,
    deadline,
    daysLeft,
    meterAt: null,
    installedNow: null,
    error: null,
  };
  if (!lines.length) return { ...out, error: `${w.ledger} is empty — the meter has not run` };
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    out.meterAt = last.ts ?? null;
    out.installedNow = typeof last.installedNow?.merchant === "number" ? last.installedNow.merchant : null;
    // appLedger is the in-app InstallEvent table regrouped by the meter, which has
    // already moved dev, Shopify-review and sandbox stores out of "merchant". It
    // survives uninstalls — the same "merchant installs N/25" the sprints quote.
    if (!Array.isArray(last.appLedger)) {
      out.error = last.appLedger?.error ?? "latest meter run has no in-app ledger";
      return out;
    }
    const n = (kind: string) =>
      (last.appLedger as LedgerGroup[]).find((r) => r.shopKind === "merchant" && r.kind === kind)?.n ?? 0;
    out.installs.n = n("installed");
    out.subscriptions.n = n("subscription_active");
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

function sprints(root: string, prefix: string): ShopifySprint[] {
  const rows: ShopifySprint[] = [];
  for (const line of readText(path.join(root, "memory", "sprint-eval-log.jsonl")).split("\n")) {
    if (!line.includes(prefix)) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r?.sprint_type !== "string" || !r.sprint_type.startsWith(prefix)) continue;
      rows.push({
        ts: String(r.ts ?? ""),
        score: typeof r.score === "number" ? r.score : NaN,
        commit: r.commit ?? null,
        shipped: clip(r.shipped ?? r.goal ?? null, 200),
      });
    } catch {
      // skip
    }
  }
  return rows.slice(-3).reverse();
}

export function shopifyTab(root: string): ShopifyTab {
  const apps = discoverApps(root).map(({ name, handle, repo }) => {
    const l = listing(root, handle);
    const w = METERS[handle];
    return {
      name,
      handle,
      repo,
      listing: l,
      gate: w ? gate(root, w, l.launched) : null,
      sprints: w ? sprints(root, w.sprintPrefix) : [],
    };
  });

  const log = readText(path.join(root, "memory", "agentic-replication-log.md"));
  const isShopify = (s: string | null) => /shopify/i.test(s ?? "");
  return {
    apps,
    candidates: {
      queue: replicationQueue(log).filter((q) => isShopify(q.title)),
      entries: replicationEntries(log).filter((e) => isShopify(e.company)),
    },
  };
}
