import fs from "node:fs";
import path from "node:path";

// Newly Up tab (Shib 2026-10-29: "make a tab on mission control for tracking this whole project,
// including FB interactions"). Everything is read from files the project already writes:
//   memory/priorities.json        — the freesite row + newlyup-* task rows (sprints keep them current)
//   memory/newlyup/fb-log.jsonl   — one line per Facebook action (join, post, comment, DM, reply)
//   freesite/data/freesite.db     — prospect pipeline + previews (SQLite since 2026-10-29, opened read-only);
//                                   falls back to the frozen prospects.json/previews.json backup if it can't open
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

type SqliteDb = { prepare(sql: string): { all(): Record<string, unknown>[]; get(): Record<string, unknown> }; close(): void };

// getBuiltinModule keeps node:sqlite out of the Next bundler; null on any failure so the JSON backup is used.
function readFreesiteDb(file: string): Pick<NewlyUpTab, "pipeline" | "previews"> | null {
  if (!fs.existsSync(file)) return null;
  let db: SqliteDb | null = null;
  try {
    const mod = (process as unknown as { getBuiltinModule?: (id: string) => { DatabaseSync: new (f: string, o: object) => SqliteDb } }).getBuiltinModule?.("node:sqlite");
    if (!mod) return null;
    db = new mod.DatabaseSync(file, { readOnly: true });
    const lanes: Record<string, number> = {};
    for (const r of db.prepare("select coalesce(lane,'unknown') lane, count(*) n from prospects group by 1").all()) lanes[String(r.lane)] = Number(r.n);
    const total = Object.values(lanes).reduce((a, b) => a + b, 0);
    const withEmail = Number(db.prepare("select count(*) n from prospects where lane in ('weaksite','nosite') and email is not null").get().n);
    const previews = db
      .prepare("select slug, name, lane, url, expires_at from previews order by built_at")
      .all()
      .map((p) => ({ slug: String(p.slug), name: String(p.name ?? ""), lane: String(p.lane ?? ""), url: String(p.url ?? ""), expires_at: String(p.expires_at) }));
    return { pipeline: { total, lanes, withEmail }, previews };
  } catch {
    return null;
  } finally {
    db?.close();
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
  let previews: NewlyUpTab["previews"] = [];
  const fromDb = readFreesiteDb(path.join(ROOT, "freesite/data/freesite.db"));
  if (fromDb) {
    ({ pipeline, previews } = fromDb);
  } else {
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
    previews = Object.values(pv).map((p) => ({ slug: p.slug, name: p.name, lane: p.lane, url: p.url, expires_at: p.expires_at }));
  }

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
