import fs from "node:fs";
import path from "node:path";

// Newly Up goal panel (Shib 2026-11-19: "10 paying clients, then 100"). The parts of the funnel that only live in
// Stripe and Instantly are fetched here by scripts/push-snapshot.mjs (this Mac, every 5 min, throttled to one fetch per
// 10 min) and cached in memory/newlyup/goal-cache.json; lib/newlyup.ts reads the cache synchronously into the snapshot.
// Never imported by the Next app: Vercel has neither the keys nor the DB.

export type InstantlyWindow = {
  contacted: number;
  /** reply_count_unique minus automatic (out-of-office) replies. */
  humanReplies: number;
  bounced: number;
  /** Every email sent in the window, follow-ups included (emails_sent_count). */
  sent: number;
};

/** Email panel (Shib 2026-11-20): per-campaign settings and today's sends, plus the inboxes' warmup health. */
export type EmailCampaignMeta = {
  id: string;
  name: string;
  /** Instantly status: 0 draft, 1 active, 2 paused, 3 completed, … */
  status: number;
  dailyLimit: number | null;
  dailyMaxLeads: number | null;
  sentToday: number;
  lastSentAt: string | null;
  inboxes: string[];
  /** C4 only: who each email went to and when, to attribute preview views to a recipient. */
  recipients?: { to: string; at: string }[];
};
export type EmailInbox = {
  email: string;
  dailyLimit: number | null;
  status: number;
  warmupStatus: number;
  warmupScore: number | null;
  /** accounts/warmup-analytics aggregate (warmup pool, not real recipients). */
  health: number | null;
  warmupSent: number | null;
  warmupInbox: number | null;
};
export type EmailMeta = { campaigns: Record<string, EmailCampaignMeta>; inboxes: EmailInbox[] };

export type GoalCache = {
  at: string;
  stripe: {
    /** Non-probe subscriptions tagged metadata.project=freesite (api/_lib/billing.js). */
    subs: { id: string; status: string; created: string; amountCents: number; ref: string; domain: string | null }[];
    /** Completed mode=setup checkouts (card saved, no charge), non-probe. */
    cards: { at: string; ref: string }[];
  } | null;
  stripeError: string | null;
  /** Per campaign label (C1/C2/C4) → window (7/30/all). */
  instantly: Record<string, Record<"7" | "30" | "all", InstantlyWindow>> | null;
  instantlyError: string | null;
  /** Email panel; fetched in the same Instantly pass. Undefined on caches written before 2026-11-20. */
  email?: EmailMeta | null;
};

// C3 is a draft: fetched for the Email panel only; the Goal funnel lists C1/C2/C4 explicitly.
export const GOAL_CAMPAIGNS: Record<string, string> = {
  C1: "e2397a96-19df-4575-854e-843e2fedf561",
  C2: "46d15145-c633-4d70-b1bd-d15dc6a3dd9a",
  C4: "b5940dbd-72ae-449d-89e8-463ed0889880",
  C3: "8fb5a286-0a9d-4f0b-98b3-de9c1d63bc27",
};

export const goalCachePath = (ROOT: string) => path.join(ROOT, "memory/newlyup/goal-cache.json");

function cred(ROOT: string, key: string): string | null {
  try {
    const m = fs
      .readFileSync(path.join(ROOT, ".credentials.env"), "utf8")
      .match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "").replace(/\\n$/, "") : null;
  } catch {
    return null;
  }
}

const isProbe = (m: Record<string, string> = {}) => m.probe === "1" || /^probe[:-]/.test(m.nu_ref || "");

async function stripeGet(key: string, p: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${p}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2024-06-20" },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`stripe ${p}: ${j.error?.message || res.status}`);
  return j;
}

async function fetchStripe(ROOT: string): Promise<GoalCache["stripe"]> {
  const key = cred(ROOT, "WATCHDOG_STRIPE_SECRET_KEY");
  if (!key) throw new Error("WATCHDOG_STRIPE_SECRET_KEY not in .credentials.env");
  const subs: NonNullable<GoalCache["stripe"]>["subs"] = [];
  let page: string | undefined;
  do {
    const j = await stripeGet(key, "subscriptions/search", {
      query: "metadata['project']:'freesite'",
      limit: "100",
      ...(page ? { page } : {}),
    });
    for (const s of j.data) {
      if (isProbe(s.metadata)) continue;
      subs.push({
        id: s.id,
        status: s.status,
        created: new Date(s.created * 1000).toISOString(),
        // Per month: the $490/yr Website plan (2026-11-20) counts $40.83, not $490.
        amountCents: Math.round(s.items.data.reduce(
          (a: number, i: { price: { unit_amount: number | null; recurring?: { interval?: string } | null }; quantity?: number }) =>
            a + ((i.price.unit_amount ?? 0) * (i.quantity ?? 1)) / (i.price.recurring?.interval === "year" ? 12 : 1),
          0,
        )),
        ref: s.metadata?.nu_ref || "",
        domain: s.metadata?.domain || null,
      });
    }
    page = j.has_more ? j.next_page : undefined;
  } while (page);

  // Checkout sessions can't be searched by metadata; walk everything since Newly Up's first checkout (late Oct).
  const cards: NonNullable<GoalCache["stripe"]>["cards"] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const j = await stripeGet(key, "checkout/sessions", {
      limit: "100",
      "created[gte]": String(Math.floor(Date.parse("2026-10-20T00:00:00Z") / 1000)),
      ...(after ? { starting_after: after } : {}),
    });
    for (const s of j.data) {
      const m = s.metadata || {};
      if (m.project !== "freesite" || s.mode !== "setup" || s.status !== "complete" || isProbe(m)) continue;
      cards.push({ at: new Date(s.created * 1000).toISOString(), ref: m.nu_ref || "" });
    }
    if (!j.has_more || !j.data.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return { subs, cards };
}

// Read-only: every call below is a GET except accounts/warmup-analytics, a POST that only reads.
async function instantlyJson(key: string, p: string, body?: object) {
  const res = await fetch(`https://api.instantly.ai/api/v2/${p}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`instantly ${p.split("?")[0]}: ${res.status}`);
  return res.json();
}

async function fetchEmailMeta(key: string, today: string): Promise<EmailMeta> {
  const campaigns: EmailMeta["campaigns"] = {};
  for (const [label, id] of Object.entries(GOAL_CAMPAIGNS)) {
    const c = await instantlyJson(key, `campaigns/${id}`);
    const daily: { date: string; sent: number }[] = await instantlyJson(
      key,
      `campaigns/analytics/daily?${new URLSearchParams({ campaign_id: id, start_date: today, end_date: today })}`,
    );
    // emails is newest first.
    const last = await instantlyJson(key, `emails?${new URLSearchParams({ campaign_id: id, email_type: "sent", limit: "1" })}`);
    const meta: EmailCampaignMeta = {
      id,
      name: String(c.name ?? label),
      status: Number(c.status),
      dailyLimit: c.daily_limit == null ? null : Number(c.daily_limit),
      dailyMaxLeads: c.daily_max_leads == null ? null : Number(c.daily_max_leads),
      sentToday: daily.filter((d) => d.date === today).reduce((a, d) => a + Number(d.sent ?? 0), 0),
      lastSentAt: last.items?.[0]?.timestamp_email ?? null,
      inboxes: Array.isArray(c.email_list) ? c.email_list : [],
    };
    if (label === "C4") {
      const recipients: { to: string; at: string }[] = [];
      let after: string | undefined;
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ campaign_id: id, email_type: "sent", limit: "100" });
        if (after) q.set("starting_after", after);
        const j = await instantlyJson(key, `emails?${q}`);
        for (const e of j.items ?? [])
          recipients.push({ to: String(e.to_address_email_list ?? "").toLowerCase(), at: String(e.timestamp_email) });
        after = j.next_starting_after;
        if (!after || !(j.items ?? []).length) break;
      }
      meta.recipients = recipients;
    }
    campaigns[label] = meta;
  }

  const used = new Set(Object.values(campaigns).flatMap((c) => c.inboxes));
  const acc = await instantlyJson(key, "accounts?limit=100");
  const accounts = (acc.items ?? []).filter((a: { email: string }) => used.has(a.email));
  const wu = accounts.length
    ? await instantlyJson(key, "accounts/warmup-analytics", { emails: accounts.map((a: { email: string }) => a.email) })
    : { aggregate_data: {} };
  const inboxes: EmailInbox[] = accounts.map(
    (a: { email: string; daily_limit?: number; status: number; warmup_status: number; stat_warmup_score?: number }) => {
      const g = wu.aggregate_data?.[a.email];
      return {
        email: a.email,
        dailyLimit: a.daily_limit == null ? null : Number(a.daily_limit),
        status: Number(a.status),
        warmupStatus: Number(a.warmup_status),
        warmupScore: a.stat_warmup_score == null ? null : Number(a.stat_warmup_score),
        health: g?.health_score == null ? null : Number(g.health_score),
        warmupSent: g?.sent == null ? null : Number(g.sent),
        warmupInbox: g?.landed_inbox == null ? null : Number(g.landed_inbox),
      };
    },
  );
  return { campaigns, inboxes };
}

async function fetchInstantly(ROOT: string): Promise<{ windows: GoalCache["instantly"]; email: EmailMeta }> {
  const key = cred(ROOT, "INSTANTLY_API_KEY");
  if (!key) throw new Error("INSTANTLY_API_KEY not in .credentials.env");
  const ymd = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const out: NonNullable<GoalCache["instantly"]> = {};
  for (const [label, id] of Object.entries(GOAL_CAMPAIGNS)) {
    const win = {} as Record<"7" | "30" | "all", InstantlyWindow>;
    for (const w of ["7", "30", "all"] as const) {
      const q = new URLSearchParams({ id });
      if (w !== "all") {
        q.set("start_date", ymd(Number(w) - 1));
        q.set("end_date", ymd(0));
      }
      const res = await fetch(`https://api.instantly.ai/api/v2/campaigns/analytics/overview?${q}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`instantly ${label} ${w}: ${res.status}`);
      const j = await res.json();
      win[w] = {
        contacted: Number(j.new_leads_contacted_count ?? j.contacted_count ?? 0),
        humanReplies: Math.max(0, Number(j.reply_count_unique ?? 0) - Number(j.reply_count_automatic_unique ?? 0)),
        bounced: Number(j.bounced_count ?? 0),
        sent: Number(j.emails_sent_count ?? 0),
      };
    }
    out[label] = win;
  }
  return { windows: out, email: await fetchEmailMeta(key, ymd(0)) };
}

/** Refreshes the cache when it is older than maxAgeMs. Never throws; a failed half keeps its previous value + error. */
export async function refreshGoalCache(ROOT: string, maxAgeMs = 10 * 60e3): Promise<string> {
  const file = goalCachePath(ROOT);
  let prev: GoalCache | null = null;
  try {
    prev = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  if (prev && Date.now() - Date.parse(prev.at) < maxAgeMs) return "goal cache fresh";
  const next: GoalCache = {
    at: new Date().toISOString(),
    stripe: prev?.stripe ?? null,
    stripeError: null,
    instantly: prev?.instantly ?? null,
    instantlyError: null,
    email: prev?.email ?? null,
  };
  await Promise.all([
    fetchStripe(ROOT).then(
      (s) => void (next.stripe = s),
      (e) => void (next.stripeError = String(e.message || e)),
    ),
    fetchInstantly(ROOT).then(
      (s) => void ((next.instantly = s.windows), (next.email = s.email)),
      (e) => void (next.instantlyError = String(e.message || e)),
    ),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 1));
  return `goal cache refreshed${next.stripeError ? ` · stripe: ${next.stripeError}` : ""}${
    next.instantlyError ? ` · instantly: ${next.instantlyError}` : ""
  }`;
}
