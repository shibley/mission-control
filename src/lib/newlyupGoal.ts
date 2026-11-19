import fs from "node:fs";
import path from "node:path";
import type { GoalCache } from "./newlyupGoalFetch.ts";

// Newly Up goal panel (Shib 2026-11-19): paying clients vs 10 → 100, the funnel per source for 7/30/all days, which
// channel produced each paying client and warm lead. Read on this Mac at snapshot time from
//   freesite.db                       — FB leads (leads, lead_events, preview_views), email replies, outreach campaigns
//   memory/newlyup/goal-cache.json    — Stripe subs + card saves, Instantly per-campaign counts (newlyupGoalFetch.ts)
//   freesite/data/c4-leads.json       — the C4 preview slugs (C4's email IS the preview)
// A step a source doesn't track is null, rendered "not tracked"; a step that can't exist for it (no preview in a C1
// email) is "n/a". Never a fake 0.

export type GoalStep = number | null | "n/a";
export type GoalRow = {
  source: string;
  leads: GoalStep;
  replied: GoalStep;
  previewSent: GoalStep;
  previewOpened: GoalStep;
  cardSaved: GoalStep;
  paid: GoalStep;
};
export type GoalWindow = "7" | "30" | "all";

export type NewlyUpGoal = {
  /** Active non-probe Stripe subs (project=freesite). null when Stripe has never been read. */
  paying: number | null;
  mrr: number | null;
  /** created dates of active subs, for the pace line. */
  payingDates: string[];
  stripeAt: string | null;
  stripeError: string | null;
  instantlyAt: string | null;
  instantlyError: string | null;
  funnel: Record<GoalWindow, GoalRow[]>;
  clients: { name: string; source: string; since: string; amount: number | null; note: string | null }[];
  warm: { name: string; source: string; stage: string; at: string | null }[];
  /** First Newly Up lead, the start of the "since start" pace. */
  startedAt: string | null;
};

type Db = {
  prepare(sql: string): { all(...a: unknown[]): Record<string, unknown>[] };
  close(): void;
};

// C4 was loaded 2026-11-19; a view of a C4 preview before then is our own build check.
const C4_START = "2026-11-19T17:00:00Z";
const WARM_EMAIL = ["buy", "positive", "price", "question"];
const PAST = ["preview-sent", "engaged", "price-quoted", "won"];
const REPLIED = ["replied", "preview-built", ...PAST];

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && t !== "llc" && t !== "inc"));

export function newlyupGoal(ROOT: string, nowMs = Date.now()): NewlyUpGoal | null {
  const file = path.join(ROOT, "freesite/data/freesite.db");
  if (!fs.existsSync(file)) return null;
  const cache = readJson<GoalCache>(path.join(ROOT, "memory/newlyup/goal-cache.json"));
  const c4 = new Set(
    (readJson<{ leads: { slug: string }[] }>(path.join(ROOT, "freesite/data/c4-leads.json"))?.leads ?? []).map(
      (l) => l.slug,
    ),
  );
  let db: Db | null = null;
  try {
    const mod = (
      process as unknown as { getBuiltinModule?: (id: string) => { DatabaseSync: new (f: string, o: object) => Db } }
    ).getBuiltinModule?.("node:sqlite");
    if (!mod) return null;
    db = new mod.DatabaseSync(file, { readOnly: true });

    // One row per lead with the evidence for each step. A later step implies the earlier ones (someone who paid
    // replied), so the funnel stays monotonic even where the event log is thinner than the stage.
    const leads = db
      .prepare(
        `select l.id, l.key, coalesce(nullif(l.business,''), l.contact_name, l.key) name, l.source, l.stage,
           l.created_at, l.updated_at, l.preview_slug, l.website,
           exists(select 1 from lead_events where lead_id = l.id and direction = 'in' and kind <> 'reaction') replied_ev,
           l.preview_slug is not null and (
             exists(select 1 from lead_events where lead_id = l.id and direction = 'out'
                    and (coalesce(text,'') like '%' || l.preview_slug || '%' or coalesce(body,'') like '%' || l.preview_slug || '%'))
             or exists(select 1 from outbox where lead_key = l.key and status = 'sent' and text like '%' || l.preview_slug || '%')
           ) sent_ev,
           (select first_at from preview_views where slug = l.preview_slug) opened_at,
           (select min(at) from lead_events where lead_id = l.id and kind = 'card-saved') card_at,
           (select min(at) from lead_events where lead_id = l.id and kind = 'billing-started') billed_at,
           exists(select 1 from previews p join clients c on c.place_id = p.place_id
                  where p.slug = l.preview_slug and c.status = 'active') live,
           (select max(at) from lead_events where lead_id = l.id and kind <> 'reaction') last_at
         from leads l`,
      )
      .all()
      .map((r) => {
        const paid = r.stage === "won" || Number(r.live) === 1;
        const card = paid || r.card_at != null;
        const sent = card || PAST.includes(String(r.stage)) || Number(r.sent_ev) === 1;
        const opened = sent && r.opened_at != null;
        const replied = sent || REPLIED.includes(String(r.stage)) || Number(r.replied_ev) === 1;
        return {
          key: String(r.key),
          name: String(r.name),
          source: String(r.source),
          stage: String(r.stage),
          created: String(r.created_at),
          slug: r.preview_slug == null ? null : String(r.preview_slug),
          website: r.website == null ? null : String(r.website),
          paidAt: paid ? String(r.billed_at ?? r.updated_at) : null,
          lastAt: r.last_at == null ? null : String(r.last_at),
          replied,
          sent,
          opened,
          card,
          paid,
        };
      });

    // place_id → email campaign label, for Stripe refs that are a place_id (the preview pages' checkout).
    const campaignOf = new Map<string, string>();
    const LABEL: Record<string, string> = {
      "e2397a96-19df-4575-854e-843e2fedf561": "email C1",
      "46d15145-c633-4d70-b1bd-d15dc6a3dd9a": "email C2",
      "8fb5a286-0a9d-4f0b-98b3-de9c1d63bc27": "email C3",
      "b5940dbd-72ae-449d-89e8-463ed0889880": "email C4",
    };
    for (const r of db.prepare("select place_id, campaign from outreach").all())
      campaignOf.set(String(r.place_id), LABEL[String(r.campaign)] ?? "email");

    const views = db.prepare("select slug, first_at from preview_views").all();
    const replies = db
      .prepare(
        `select r.lead, r.campaign, r.cls, r.received_at, p.name from replies r left join prospects p on p.place_id = r.place_id`,
      )
      .all();

    // Stripe ref → source + matching lead. fb:<slug-ish> matches a lead by key/preview slug/token subset.
    const matchLead = (ref: string, domain: string | null) => {
      const id = ref.replace(/^[a-z]+:/, "");
      const want = tokens(id);
      return leads.find(
        (l) =>
          l.key === id ||
          l.slug === id ||
          (domain && l.website?.includes(domain)) ||
          (l.slug && want.size > 1 && [...want].every((t) => tokens(l.slug!).has(t))),
      );
    };
    const refSource = (ref: string, domain: string | null) => {
      const l = matchLead(ref, domain);
      if (l) return { source: l.source, lead: l };
      if (ref.startsWith("fb:")) return { source: "fb (no lead row)", lead: null };
      if (ref.startsWith("ig:")) return { source: "instagram", lead: null };
      if (campaignOf.has(ref)) return { source: campaignOf.get(ref)!, lead: null };
      return { source: ref ? `other (${ref.split(":")[0]})` : "unknown", lead: null };
    };

    const stripe = cache?.stripe ?? null;
    const active = stripe?.subs.filter((s) => s.status === "active") ?? [];

    const since = (w: GoalWindow) => (w === "all" ? "" : new Date(nowMs - Number(w) * 864e5).toISOString());
    const funnel = {} as Record<GoalWindow, GoalRow[]>;
    for (const w of ["7", "30", "all"] as GoalWindow[]) {
      const from = since(w);
      const rows: GoalRow[] = [];
      // FB (and site-form) leads: cohort = leads created in the window, and how far each got.
      const sources = [...new Set(leads.map((l) => l.source))].sort();
      for (const src of sources) {
        const ls = leads.filter((l) => l.source === src && l.created >= from);
        rows.push({
          source: src,
          leads: ls.length,
          replied: ls.filter((l) => l.replied).length,
          previewSent: ls.filter((l) => l.sent).length,
          previewOpened: ls.filter((l) => l.opened).length,
          cardSaved: ls.filter((l) => l.card).length,
          paid: ls.filter((l) => l.paid).length,
        });
      }
      // Email: Instantly's contacted/human-replied counts for the window; card saves and paid from Stripe refs that are
      // a place_id in that campaign, dated in the window.
      for (const label of ["C1", "C2", "C4"]) {
        const iw = cache?.instantly?.[label]?.[w];
        const name = `email ${label}`;
        const cardsN = stripe
          ? stripe.cards.filter((c) => c.at >= from && campaignOf.get(c.ref) === name).length
          : null;
        const paidN = stripe
          ? stripe.subs.filter((s) => s.created >= from && s.status === "active" && campaignOf.get(s.ref) === name)
              .length
          : null;
        const isC4 = label === "C4";
        rows.push({
          source: name,
          leads: iw ? iw.contacted : null,
          replied: iw ? iw.humanReplies : null,
          // C4's first email shows their own preview; C1/C2 emails carry no preview link.
          previewSent: isC4 ? (iw ? iw.contacted : null) : "n/a",
          previewOpened: isC4
            ? views.filter((v) => c4.has(String(v.slug)) && String(v.first_at) >= (from > C4_START ? from : C4_START)).length
            : "n/a",
          cardSaved: cardsN,
          paid: paidN,
        });
      }
      funnel[w] = rows;
    }

    const clients: NewlyUpGoal["clients"] = active.map((s) => {
      const { source, lead } = refSource(s.ref, s.domain);
      return {
        name: lead?.name ?? s.domain ?? s.ref,
        source,
        since: s.created,
        amount: s.amountCents / 100,
        note: null,
      };
    });
    // A lead marked won in freesite.db with no active Stripe sub still shows, flagged.
    for (const l of leads.filter((l) => l.paid)) {
      const inStripe = active.some((s) => refSource(s.ref, s.domain).lead?.key === l.key);
      if (!inStripe)
        clients.push({
          name: l.name,
          source: l.source,
          since: l.paidAt ?? l.created,
          amount: null,
          note: stripe ? "won in freesite.db, no active Stripe sub" : "Stripe not read",
        });
    }

    const warm: NewlyUpGoal["warm"] = [
      ...leads
        .filter((l) => !l.paid && (["engaged", "price-quoted"].includes(l.stage) || l.card))
        .map((l) => ({ name: l.name, source: l.source, stage: l.card ? "card saved" : l.stage, at: l.lastAt })),
      ...replies
        .filter((r) => WARM_EMAIL.includes(String(r.cls)))
        .map((r) => ({
          name: String(r.name ?? r.lead),
          source: LABEL[String(r.campaign)] ?? "email",
          stage: `replied: ${r.cls}`,
          at: r.received_at == null ? null : String(r.received_at),
        })),
    ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

    return {
      paying: stripe ? active.length : null,
      mrr: stripe ? active.reduce((a, s) => a + s.amountCents, 0) / 100 : null,
      payingDates: active.map((s) => s.created),
      stripeAt: stripe ? cache!.at : null,
      stripeError: cache?.stripeError ?? (cache ? null : "goal-cache.json not written yet"),
      instantlyAt: cache?.instantly ? cache.at : null,
      instantlyError: cache?.instantlyError ?? null,
      funnel,
      clients,
      warm,
      startedAt: leads.map((l) => l.created).sort()[0] ?? null,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
