import fs from "node:fs";
import path from "node:path";

// Newly Up tab (Shib 2026-10-29: "make a tab on mission control for tracking this whole project,
// including FB interactions"). Everything is read from files the project already writes:
//   memory/priorities.json        — the freesite row + newlyup-* task rows (sprints keep them current)
//   memory/newlyup/fb-log.jsonl   — one line per Facebook action (join, post, comment, DM, reply)
//   freesite/data/prospects.json  — prospect pipeline (lanes)
//   freesite/data/previews.json   — previews built (only after interest, plus the 5 proofs)
//   memory/freesite-roadmap.md    — the Log section, newest lines shown

export type FbEvent = {
  at: string;
  kind: string; // join | post | comment | dm | reply | lead
  group?: string;
  group_url?: string;
  post_url?: string;
  who?: string;
  status?: string;
  note?: string;
};

export type NewlyUpTask = { id: string; title: string; owner: string; status: string };

export type NewlyUpTab = {
  tasks: NewlyUpTask[];
  fb: FbEvent[];
  pipeline: { total: number; lanes: Record<string, number>; withEmail: number } | null;
  previews: { slug: string; name: string; lane: string; url: string; expires_at: string }[];
  log: string[];
  links: { label: string; url: string }[];
  error: string | null;
};

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export function newlyupTab(ROOT: string): NewlyUpTab {
  const errs: string[] = [];
  const pri = readJson<{ items: (NewlyUpTask & Record<string, unknown>)[] }>(path.join(ROOT, "memory/priorities.json"));
  const tasks = (pri?.items || [])
    .filter((i) => String(i.id).startsWith("newlyup-") || i.id === "freesite")
    .map((i) => ({ id: String(i.id), title: String(i.title).replace(/^↳ Newly Up: /, ""), owner: String(i.owner), status: String(i.status) }));

  let fb: FbEvent[] = [];
  try {
    fb = fs
      .readFileSync(path.join(ROOT, "memory/newlyup/fb-log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as FbEvent)
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch (e) {
    errs.push(`fb-log: ${(e as Error).message}`);
  }

  let pipeline: NewlyUpTab["pipeline"] = null;
  const pros = readJson<unknown>(path.join(ROOT, "freesite/data/prospects.json"));
  if (pros) {
    const rows = (Array.isArray(pros) ? pros : Object.values((pros as { prospects?: object }).prospects || pros)) as Record<string, unknown>[];
    const lanes: Record<string, number> = {};
    let withEmail = 0;
    for (const r of rows) {
      const l = String(r.lane || "unknown");
      lanes[l] = (lanes[l] || 0) + 1;
      if ((l === "weaksite" || l === "nosite") && (r.email || (Array.isArray(r.emails) && r.emails.length))) withEmail++;
    }
    pipeline = { total: rows.length, lanes, withEmail };
  }

  const pv = readJson<Record<string, NewlyUpTab["previews"][number]>>(path.join(ROOT, "freesite/data/previews.json")) || {};
  const previews = Object.values(pv).map((p) => ({ slug: p.slug, name: p.name, lane: p.lane, url: p.url, expires_at: p.expires_at }));

  let log: string[] = [];
  try {
    const md = fs.readFileSync(path.join(ROOT, "memory/freesite-roadmap.md"), "utf8");
    const i = md.indexOf("## Log");
    if (i >= 0) {
      log = md
        .slice(i)
        .split("\n")
        .filter((l) => /^- 20\d\d-/.test(l))
        .slice(-8)
        .reverse()
        .map((l) => l.replace(/^- /, "").replace(/\*\*/g, "").slice(0, 260));
    }
  } catch (e) {
    errs.push(`roadmap: ${(e as Error).message}`);
  }

  return {
    tasks,
    fb,
    pipeline,
    previews,
    log,
    links: [
      { label: "newlyup.com", url: "https://newlyup.com" },
      { label: "About page", url: "https://newlyup.com/about" },
      { label: "Booking (Cal.com)", url: "https://cal.com/newlyup/website-chat" },
      { label: "Stripe $297/mo link", url: "https://buy.stripe.com/8x27sLgmc9wL24ybq16J20g" },
    ],
    error: errs.length ? errs.join("; ") : null,
  };
}
