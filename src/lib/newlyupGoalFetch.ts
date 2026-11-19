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
};

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
};

export const GOAL_CAMPAIGNS: Record<string, string> = {
  C1: "e2397a96-19df-4575-854e-843e2fedf561",
  C2: "46d15145-c633-4d70-b1bd-d15dc6a3dd9a",
  C4: "b5940dbd-72ae-449d-89e8-463ed0889880",
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
        amountCents: s.items.data.reduce(
          (a: number, i: { price: { unit_amount: number | null }; quantity?: number }) =>
            a + (i.price.unit_amount ?? 0) * (i.quantity ?? 1),
          0,
        ),
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

async function fetchInstantly(ROOT: string): Promise<GoalCache["instantly"]> {
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
      };
    }
    out[label] = win;
  }
  return out;
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
  };
  await Promise.all([
    fetchStripe(ROOT).then(
      (s) => void (next.stripe = s),
      (e) => void (next.stripeError = String(e.message || e)),
    ),
    fetchInstantly(ROOT).then(
      (s) => void (next.instantly = s),
      (e) => void (next.instantlyError = String(e.message || e)),
    ),
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 1));
  return `goal cache refreshed${next.stripeError ? ` · stripe: ${next.stripeError}` : ""}${
    next.instantlyError ? ` · instantly: ${next.instantlyError}` : ""
  }`;
}
