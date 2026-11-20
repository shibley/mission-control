import fs from "node:fs";
import path from "node:path";
import type { GoalCache } from "./newlyupGoalFetch.ts";

// Email panel on /newlyup (Shib 2026-11-20: "add tracking to mission control for email campaign"). Read on this Mac at
// snapshot time from
//   memory/newlyup/goal-cache.json   — Instantly settings, sends, bounces, inbox warmup (newlyupGoalFetch.ts)
//   freesite.db replies              — freesite's reply class (not Instantly's "opportunity" flag, which called an
//                                      auto-reply an opportunity)
//   freesite.db preview_views + data/c4-leads.json — C4 preview visits, matched recipient email → their preview slug
//   memory/newlyup-deliverability-check-*.md      — the latest seed test
// Anything not tracked is null, rendered "not tracked". Never a fake 0.

export type EmailWin = { contacted: number; sent: number; bounced: number } | null;
export type ReplySplit = { interested: number; auto: number; decline: number; bounce: number; other: number; total: number };

export type EmailCampaignRow = {
  label: string;
  name: string;
  status: string;
  dailyLimit: number | null;
  sentToday: number | null;
  lastSentAt: string | null;
  all: EmailWin;
  d7: EmailWin;
  replies: { all: ReplySplit; d7: ReplySplit } | null;
  /** C4 only. null = not attributable/not read. */
  previewVisits: { recipients: number; visited: number; views: number; syncedAt: string | null } | null;
};

export type NewlyUpEmail = {
  at: string | null;
  error: string | null;
  campaigns: EmailCampaignRow[];
  capacity: { activeLimits: number; draftLimits: number; inboxCap: number | null; inboxCount: number } | null;
  inboxes: { email: string; dailyLimit: number | null; warmup: string; score: number | null; health: number | null; inboxed: string | null }[] | null;
  seed: { checked: string; file: string; lines: string[] } | null;
};

type Db = {
  prepare(sql: string): { all(...a: unknown[]): Record<string, unknown>[] };
  close(): void;
};

const STATUS: Record<number, string> = {
  0: "draft",
  1: "active",
  2: "paused",
  3: "completed",
  4: "running subsequences",
  [-1]: "accounts unhealthy",
  [-2]: "bounce protect",
  [-99]: "suspended",
};
const ORDER = ["C1", "C2", "C4", "C3"];

// freesite lib/reply.mjs classes → panel buckets. "client" is a reply from someone who already saved a card.
const BUCKET: Record<string, keyof Omit<ReplySplit, "total">> = {
  buy: "interested",
  positive: "interested",
  price: "interested",
  question: "interested",
  client: "interested",
  auto_reply: "auto",
  not_interested: "decline",
  unsubscribe: "decline",
  bounce: "bounce",
};

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The "Seed test" section of the newest deliverability check, as plain lines. */
function seedTest(ROOT: string): NewlyUpEmail["seed"] {
  const dir = path.join(ROOT, "memory");
  const file = fs
    .readdirSync(dir)
    .filter((f) => /^newlyup-deliverability-check-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .pop();
  if (!file) return null;
  const md = fs.readFileSync(path.join(dir, file), "utf8");
  const m = md.match(/^#{2,3} Seed test\s*\n([\s\S]*?)(?=^#{1,3} )/m);
  if (!m) return null;
  const lines = m[1]
    .split("\n")
    .map((l) => l.replace(/\*\*|`/g, "").replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  return { checked: file.match(/(\d{4}-\d{2}-\d{2})/)![1], file: `memory/${file}`, lines };
}

export function newlyupEmail(ROOT: string, nowMs = Date.now()): NewlyUpEmail | null {
  const cache = readJson<GoalCache>(path.join(ROOT, "memory/newlyup/goal-cache.json"));
  const meta = cache?.email ?? null;
  const c4Leads =
    readJson<{ leads: { email: string; slug: string }[] }>(path.join(ROOT, "freesite/data/c4-leads.json"))?.leads ?? [];

  let db: Db | null = null;
  try {
    const file = path.join(ROOT, "freesite/data/freesite.db");
    const mod = (
      process as unknown as { getBuiltinModule?: (id: string) => { DatabaseSync: new (f: string, o: object) => Db } }
    ).getBuiltinModule?.("node:sqlite");
    if (mod && fs.existsSync(file)) db = new mod.DatabaseSync(file, { readOnly: true });

    const since7 = new Date(nowMs - 7 * 864e5).toISOString();
    const replies = db?.prepare("select campaign, cls, received_at from replies").all() ?? null;
    const split = (rows: Record<string, unknown>[]): ReplySplit => {
      const s: ReplySplit = { interested: 0, auto: 0, decline: 0, bounce: 0, other: 0, total: rows.length };
      for (const r of rows) s[BUCKET[String(r.cls)] ?? "other"]++;
      return s;
    };
    const views = db?.prepare("select slug, last_at, views, updated_at from preview_views").all() ?? null;

    const campaigns: EmailCampaignRow[] = ORDER.filter((l) => meta?.campaigns[l]).map((label) => {
      const c = meta!.campaigns[label];
      const win = (w: "7" | "all"): EmailWin => {
        const x = cache?.instantly?.[label]?.[w];
        // `sent` is new on 2026-11-20; a cache written before it has no follow-up count.
        return x && x.sent != null ? { contacted: x.contacted, sent: x.sent, bounced: x.bounced } : null;
      };
      const mine = replies?.filter((r) => r.campaign === c.id) ?? null;

      let previewVisits: EmailCampaignRow["previewVisits"] = null;
      if (label === "C4" && c.recipients && views) {
        // Each C4 email links the recipient's own preview (newlyup.com/p/<slug>), so a non-bot view of that slug
        // after their email went out is theirs (or our own check of it).
        const slugOf = new Map(c4Leads.map((l) => [l.email.toLowerCase(), l.slug]));
        const firstSend = new Map<string, string>();
        for (const r of c.recipients) {
          const slug = slugOf.get(r.to);
          if (slug && (!firstSend.has(slug) || r.at < firstSend.get(slug)!)) firstSend.set(slug, r.at);
        }
        const v = views.filter((x) => firstSend.has(String(x.slug)) && String(x.last_at) >= firstSend.get(String(x.slug))!);
        previewVisits = {
          recipients: firstSend.size,
          visited: v.length,
          views: v.reduce((a, x) => a + Number(x.views ?? 0), 0),
          syncedAt: views.map((x) => String(x.updated_at ?? "")).sort().pop() || null,
        };
      }

      return {
        label,
        name: c.name,
        status: STATUS[c.status] ?? `status ${c.status}`,
        dailyLimit: c.dailyLimit,
        sentToday: c.sentToday,
        lastSentAt: c.lastSentAt,
        all: win("all"),
        d7: win("7"),
        replies: mine ? { all: split(mine), d7: split(mine.filter((r) => String(r.received_at ?? "") >= since7)) } : null,
        previewVisits,
      };
    });

    const inboxes = meta?.inboxes ?? null;
    const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
    const all = meta ? Object.values(meta.campaigns) : [];
    let seed: NewlyUpEmail["seed"] = null;
    try {
      seed = seedTest(ROOT);
    } catch {}

    return {
      at: meta ? cache!.at : null,
      error: cache?.instantlyError ?? (meta ? null : cache ? "email fields not cached yet" : "goal-cache.json not written yet"),
      campaigns,
      capacity: meta
        ? {
            activeLimits: sum(all.filter((c) => c.status === 1).map((c) => c.dailyLimit)),
            draftLimits: sum(all.filter((c) => c.status === 0).map((c) => c.dailyLimit)),
            inboxCap: inboxes && inboxes.every((i) => i.dailyLimit != null) ? sum(inboxes.map((i) => i.dailyLimit)) : null,
            inboxCount: inboxes?.length ?? 0,
          }
        : null,
      inboxes:
        inboxes?.map((i) => ({
          email: i.email,
          dailyLimit: i.dailyLimit,
          warmup: i.warmupStatus === 1 ? "on" : i.warmupStatus === 0 ? "off" : `status ${i.warmupStatus}`,
          score: i.warmupScore,
          health: i.health,
          inboxed: i.warmupSent ? `${i.warmupInbox ?? 0}/${i.warmupSent}` : null,
        })) ?? null,
      seed,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
