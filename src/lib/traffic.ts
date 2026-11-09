import { Pool } from "pg";

// First-party beacon data: analytics.events (written by each site's /api beacon).
// "Real visitors" = count(distinct session_hash) where not is_bot. All day
// boundaries are America/Los_Angeles; 7d/30d windows are rolling from now().

const TZ = "America/Los_Angeles";
const TTL_MS = 5 * 60 * 1000;

export type SiteSummary = {
  site: string;
  today: number;
  yesterday: number;
  d7: number;
  prev7: number;
  d30: number;
  pageviews7: number;
  bots7: number;
};

export type DayPoint = { day: string; visitors: number; pageviews: number };
export type TopRow = { key: string; visitors: number };

export type SiteDetail = {
  site: string;
  daily: DayPoint[];
  pages: TopRow[];
  referrers: TopRow[];
  countries: TopRow[];
  utmSources: TopRow[];
};

export type TrafficData =
  | { ok: true; generatedAt: string; sites: SiteSummary[]; detail: SiteDetail }
  | { ok: false; error: string };

const g = globalThis as unknown as {
  __trafficPool?: Pool;
  __trafficCache?: Map<string, { at: number; value: Promise<unknown> }>;
};

function pool(): Pool {
  if (!g.__trafficPool) {
    const url = process.env.ANALYTICS_DATABASE_URL;
    if (!url) throw new Error("ANALYTICS_DATABASE_URL is not set");
    g.__trafficPool = new Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
    });
  }
  return g.__trafficPool;
}

// 5-minute memo; the promise is cached so concurrent requests share one query.
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cache = (g.__trafficCache ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

const n = (v: unknown) => Number(v ?? 0);

// Loose index scan over events_site_ts_idx: distinct sites seen in the last 30d
// without reading every row.
async function listSites(): Promise<string[]> {
  const { rows } = await pool().query<{ site: string }>(
    `with recursive s as (
       (select site from analytics.events where ts >= now() - interval '30 days' order by site limit 1)
       union all
       select (select e.site from analytics.events e
                where e.site > s.site and e.ts >= now() - interval '30 days'
                order by e.site limit 1)
       from s where s.site is not null
     )
     select site from s where site is not null`,
  );
  return rows.map((r) => r.site);
}

async function summary(site: string): Promise<SiteSummary> {
  const { rows } = await pool().query(
    `with b as (
       select (date_trunc('day', now() at time zone '${TZ}') at time zone '${TZ}') as today0
     )
     select
       count(distinct session_hash) filter (where not is_bot and ts >= b.today0) as today,
       count(distinct session_hash) filter (where not is_bot and ts >= b.today0 - interval '1 day' and ts < b.today0) as yesterday,
       count(distinct session_hash) filter (where not is_bot and ts >= now() - interval '7 days') as d7,
       count(distinct session_hash) filter (where not is_bot and ts >= now() - interval '14 days' and ts < now() - interval '7 days') as prev7,
       count(distinct session_hash) filter (where not is_bot) as d30,
       count(*) filter (where not is_bot and ts >= now() - interval '7 days') as pageviews7,
       count(*) filter (where is_bot and ts >= now() - interval '7 days') as bots7
     from analytics.events, b
     where site = $1 and ts >= now() - interval '30 days'`,
    [site],
  );
  const r = rows[0];
  return {
    site,
    today: n(r.today),
    yesterday: n(r.yesterday),
    d7: n(r.d7),
    prev7: n(r.prev7),
    d30: n(r.d30),
    pageviews7: n(r.pageviews7),
    bots7: n(r.bots7),
  };
}

async function daily(site: string): Promise<DayPoint[]> {
  const { rows } = await pool().query(
    `with days as (
       select generate_series(
         (now() at time zone '${TZ}')::date - 29,
         (now() at time zone '${TZ}')::date,
         interval '1 day')::date as day
     ),
     agg as (
       select (ts at time zone '${TZ}')::date as day,
              count(distinct session_hash) as visitors,
              count(*) as pageviews
       from analytics.events
       where site = $1 and not is_bot
         and ts >= (((now() at time zone '${TZ}')::date - 29)::timestamp at time zone '${TZ}')
       group by 1
     )
     select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(agg.visitors, 0) as visitors,
            coalesce(agg.pageviews, 0) as pageviews
     from days left join agg using (day) order by days.day`,
    [site],
  );
  return rows.map((r) => ({ day: r.day, visitors: n(r.visitors), pageviews: n(r.pageviews) }));
}

const TOP_COLUMNS = {
  pages: "path",
  referrers: "referrer_host",
  countries: "country",
  utmSources: "utm_source",
} as const;

async function top(site: string, col: (typeof TOP_COLUMNS)[keyof typeof TOP_COLUMNS], limit: number): Promise<TopRow[]> {
  const { rows } = await pool().query(
    `select coalesce(nullif(${col}, ''), '(none)') as key, count(distinct session_hash) as visitors
     from analytics.events
     where site = $1 and not is_bot and ts >= now() - interval '7 days'
     group by 1 order by 2 desc, 1 limit $2`,
    [site, limit],
  );
  return rows.map((r) => ({ key: r.key, visitors: n(r.visitors) }));
}

async function detail(site: string): Promise<SiteDetail> {
  const [d, pages, referrers, countries, utmSources] = await Promise.all([
    daily(site),
    top(site, TOP_COLUMNS.pages, 15),
    top(site, TOP_COLUMNS.referrers, 15),
    top(site, TOP_COLUMNS.countries, 15),
    top(site, TOP_COLUMNS.utmSources, 15),
  ]);
  return { site, daily: d, pages, referrers, countries, utmSources };
}

export async function getTraffic(site: string): Promise<TrafficData> {
  try {
    const sites = await cached("sites", listSites);
    const [summaries, det] = await Promise.all([
      cached("summary", async () => ({
        at: new Date().toISOString(),
        rows: (await Promise.all(sites.map(summary))).sort((a, b) => b.d7 - a.d7),
      })),
      cached(`detail:${site}`, () => detail(site)),
    ]);
    return { ok: true, generatedAt: summaries.at, sites: summaries.rows, detail: det };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
