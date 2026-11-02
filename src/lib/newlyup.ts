import fs from "node:fs";
import path from "node:path";

// Newly Up tab (Shib 2026-10-29: "make a tab on mission control for tracking this whole project,
// including FB interactions"). Everything is read from files the project already writes:
//   memory/priorities.json        — the freesite row + newlyup-* task rows (sprints keep them current)
//   memory/newlyup/fb-log.jsonl   — one line per Facebook action (join, post, comment, DM, reply)
//   freesite/data/freesite.db     — prospect pipeline + previews (SQLite since 2026-10-29, opened read-only);
//                                   falls back to the frozen prospects.json/previews.json backup if it can't open
//   memory/freesite-roadmap.md    — the Log section, newest lines shown
//   freesite.db leads/lead_events/fb_groups — lead pipeline + FB groups (written by freesite/scripts/nu-track.mjs);
//                                   if the DB can't open they are rebuilt roughly from fb-log.jsonl (+ fb-groups.jsonl)

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

export type NewlyUpLead = {
  key: string;
  business: string;
  contact: string | null;
  source: string;
  city: string | null;
  stage: string;
  group: string | null;
  next_action: string | null;
  next_action_at: string | null;
  preview_url: string | null;
  last_at: string | null;
  last_text: string | null;
};

export type NewlyUpGroup = {
  city: string | null;
  name: string;
  url: string;
  members: number | null;
  joined: boolean;
  joined_at: string | null;
  posted_at: string | null;
  leads: number;
  note: string | null;
};

export type NewlyUpTab = {
  tasks: NewlyUpTask[];
  leads: NewlyUpLead[];
  groups: NewlyUpGroup[];
  leadsSource: "db" | "jsonl";
  fb: FbEvent[];
  pipeline: { total: number; lanes: Record<string, number>; withEmail: number } | null;
  previews: { slug: string; name: string; lane: string; url: string; expires_at: string }[];
  log: string[];
  features?: { n: string; idea: string; source: string; notes: string }[];
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
function readFreesiteDb(file: string): (Pick<NewlyUpTab, "pipeline" | "previews"> & { leads: NewlyUpLead[] | null; groups: NewlyUpGroup[] | null }) | null {
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
    const str = (v: unknown) => (v == null || v === "" ? null : String(v));
    const hasLeads = db.prepare("select count(*) n from sqlite_master where type='table' and name in ('leads','fb_groups')").get().n === 2;
    const leads = hasLeads
      ? db
          .prepare(
            `select l.*, p.url preview_url, e.at last_at, e.text last_text from leads l
             left join previews p on p.slug = l.preview_slug
             left join lead_events e on e.id = (select id from lead_events where lead_id = l.id order by at desc, id desc limit 1)
             order by coalesce(e.at, l.updated_at) desc`,
          )
          .all()
          .map((r) => ({
            key: String(r.key),
            business: String(r.business || r.contact_name || r.key),
            contact: str(r.contact_name),
            source: String(r.source),
            city: str(r.city),
            stage: String(r.stage),
            group: str(r.group_name),
            next_action: str(r.next_action),
            next_action_at: str(r.next_action_at),
            preview_url: str(r.preview_url) ?? (r.preview_slug ? `https://newlyup.com/p/${r.preview_slug}` : null),
            last_at: str(r.last_at),
            last_text: str(r.last_text),
          }))
      : null;
    const groups = hasLeads
      ? db
          .prepare("select * from fb_groups order by joined desc, coalesce(posted_at, joined_at, updated_at) desc")
          .all()
          .map((r) => ({
            city: str(r.city),
            name: String(r.name),
            url: String(r.url),
            members: r.members == null ? null : Number(r.members),
            joined: Number(r.joined) === 1,
            joined_at: str(r.joined_at),
            posted_at: str(r.posted_at),
            leads: Number(r.leads_count || 0),
            note: str(r.note),
          }))
      : null;
    return { pipeline: { total, lanes, withEmail }, previews, leads, groups };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// Fallback when freesite.db can't be read: one lead per distinct fb-log "who" (latest kind=lead status as the stage
// hint), groups from join/post rows plus fb-groups.jsonl. Rough, but the card never goes blank.
function leadsFromJsonl(ROOT: string, fb: FbEvent[]): { leads: NewlyUpLead[]; groups: NewlyUpGroup[] } {
  const byWho = new Map<string, NewlyUpLead>();
  for (const e of [...fb].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.kind !== "lead" || !e.who) continue;
    const name = e.who.split(" / ").pop()!.replace(/\s*\(.*\)$/, "");
    const k = e.who.split(" / ")[0].toLowerCase(); // the person, so "X" and "X / Their Biz LLC" merge
    const prev = byWho.get(k);
    const url = e.note?.match(/https:\/\/newlyup\.com\/p\/[\w-]+/)?.[0] ?? prev?.preview_url ?? null;
    byWho.set(k, {
      key: k,
      business: e.who.includes(" / ") ? name : (prev?.business ?? name),
      contact: e.who.includes(" / ") ? e.who.split(" / ")[0] : (prev?.contact ?? null),
      source: (e as FbEvent & { source?: string }).source || "fb-comment",
      city: null,
      stage: e.status || "new",
      group: e.group ?? prev?.group ?? null,
      next_action: null,
      next_action_at: null,
      preview_url: url,
      last_at: e.at,
      last_text: e.note ?? null,
    });
  }
  const groups = new Map<string, NewlyUpGroup>();
  for (const e of [...fb].sort((a, b) => a.at.localeCompare(b.at))) {
    if ((e.kind !== "join" && e.kind !== "post") || !e.group_url) continue;
    const g = groups.get(e.group_url) ?? { city: null, name: e.group || e.group_url, url: e.group_url, members: null, joined: false, joined_at: null, posted_at: null, leads: 0, note: null };
    if (e.kind === "join" && e.status === "joined") Object.assign(g, { joined: true, joined_at: e.at });
    if (e.kind === "post" && e.status !== "declined") g.posted_at ??= e.at;
    g.note = `${e.kind} ${e.status ?? ""}`.trim();
    groups.set(e.group_url, g);
  }
  try {
    for (const l of fs.readFileSync(path.join(ROOT, "memory/newlyup/fb-groups.jsonl"), "utf8").split("\n").filter(Boolean)) {
      try {
        const c = JSON.parse(l) as Record<string, unknown>;
        if (!c.url) continue;
        const g = groups.get(String(c.url)) ?? { city: null, name: String(c.name || c.url), url: String(c.url), members: null, joined: false, joined_at: null, posted_at: null, leads: 0, note: null };
        if (c.city) g.city = String(c.city);
        if (c.members != null) g.members = Number(c.members) || null;
        if (c.joined) g.joined = true;
        if (c.posted_at) g.posted_at = String(c.posted_at);
        groups.set(g.url, g);
      } catch {}
    }
  } catch {}
  const leads = [...byWho.values()].reverse();
  for (const g of groups.values()) g.leads = leads.filter((l) => l.group === g.name).length;
  return { leads, groups: [...groups.values()] };
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
  let leads = fromDb?.leads ?? null;
  let groups = fromDb?.groups ?? null;
  const leadsSource: NewlyUpTab["leadsSource"] = leads && groups ? "db" : "jsonl";
  if (!leads || !groups) ({ leads, groups } = leadsFromJsonl(ROOT, fb));
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

  let features: { n: string; idea: string; source: string; notes: string }[] = [];
  try {
    const fl = fs.readFileSync(path.join(ROOT, "memory/newlyup/feature-log.md"), "utf8");
    features = fl
      .split("\n")
      .filter((l) => /^\|\s*\d+\s*\|/.test(l))
      .map((l) => l.split("|").slice(1, -1).map((c) => c.trim().replace(/\*\*/g, "")))
      .map(([n, idea, source, notes]) => ({ n, idea, source, notes }));
  } catch (e) {
    errs.push(`feature-log: ${(e as Error).message}`);
  }

  return {
    tasks,
    leads,
    groups,
    leadsSource,
    fb,
    pipeline,
    previews,
    log,
    features,
    links: [
      { label: "newlyup.com", url: "https://newlyup.com" },
      { label: "About page", url: "https://newlyup.com/about" },
      { label: "Booking (Cal.com)", url: "https://cal.com/newlyup/website-chat" },
      { label: "Card-on-file page (/reserve)", url: "https://newlyup.com/reserve" },
      { label: "No-pricing page (/welcome)", url: "https://newlyup.com/welcome" },
    ],
    error: errs.length ? errs.join("; ") : null,
  };
}
