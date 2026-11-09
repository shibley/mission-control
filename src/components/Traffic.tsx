import Link from "next/link";
import type { DayPoint, SiteSummary, TopRow, TrafficData } from "@/lib/traffic";

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">{title}</h2>
        {right ? <div className="text-xs text-white/40">{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

const fmt = (v: number) => v.toLocaleString("en-US");

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Change({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-white/30">{cur ? "new" : "—"}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100) || 0;
  const tone = pct > 0 ? "text-emerald-300" : pct < 0 ? "text-rose-300" : "text-white/50";
  return (
    <span className={tone}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  );
}

function SummaryTable({ sites, selected }: { sites: SiteSummary[]; selected: string }) {
  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-white/40">
          <tr className="border-b border-white/10">
            <th className="px-2 py-1.5 text-left font-medium">Site</th>
            <th className={th}>Today</th>
            <th className={th}>Yesterday</th>
            <th className={th}>7d</th>
            <th className={th}>30d</th>
            <th className={th}>7d vs prev 7d</th>
            <th className={th}>Pageviews 7d</th>
            <th className={th}>Bot hits 7d</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.site}
              className={`border-b border-white/5 ${s.site === selected ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
            >
              <td className="px-2 py-1.5">
                <Link href={`/traffic?site=${s.site}`} className="hover:underline">
                  {s.site}
                </Link>
              </td>
              <td className={`${td} text-white/60`}>{fmt(s.today)}</td>
              <td className={td}>{fmt(s.yesterday)}</td>
              <td className={`${td} font-semibold`}>{fmt(s.d7)}</td>
              <td className={td}>{fmt(s.d30)}</td>
              <td className={td}>
                <Change cur={s.d7} prev={s.prev7} />
              </td>
              <td className={`${td} text-white/60`}>{fmt(s.pageviews7)}</td>
              <td className={`${td} text-white/40`}>{fmt(s.bots7)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyChart({ days }: { days: DayPoint[] }) {
  const W = 900;
  const H = 220;
  const padL = 40;
  const padB = 22;
  const padT = 16;
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const step = (W - padL) / days.length;
  const bw = Math.max(2, step * 0.72);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily real visitors, last 30 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.08)" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.4)">
            {fmt(t)}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const partial = i === days.length - 1;
        const x = padL + i * step + (step - bw) / 2;
        const top = y(d.visitors);
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${fmt(d.visitors)} visitors · ${fmt(d.pageviews)} pageviews${partial ? " (today, partial)" : ""}`}</title>
            <rect
              x={x}
              y={top}
              width={bw}
              height={Math.max(0, H - padB - top)}
              rx={2}
              fill={partial ? "rgba(56,189,248,0.25)" : "rgb(56,189,248)"}
              stroke={partial ? "rgb(56,189,248)" : "none"}
              strokeDasharray={partial ? "3 2" : undefined}
            />
            {(i % 5 === 0 || partial) && (
              <text
                x={x + bw / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                fill={partial ? "rgb(125,211,252)" : "rgba(255,255,255,0.4)"}
              >
                {partial ? "today*" : d.day.slice(5)}
              </text>
            )}
            {partial && (
              <text x={x + bw / 2} y={top - 4} textAnchor="middle" fontSize="10" fill="rgb(125,211,252)">
                {fmt(d.visitors)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TopList({ title, rows }: { title: string; rows: TopRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <Card title={title} right="visitors · 7d">
      {rows.length ? (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="relative flex items-baseline justify-between gap-3 px-1.5 py-0.5">
              <div
                className="absolute inset-y-0 left-0 rounded bg-sky-400/10"
                style={{ width: `${(r.visitors / max) * 100}%` }}
              />
              <span className="relative truncate text-white/80" title={r.key}>
                {r.key}
              </span>
              <span className="relative shrink-0 tabular-nums text-white/60">{fmt(r.visitors)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white/40">No visitors in the last 7 days.</p>
      )}
    </Card>
  );
}

export default function Traffic({ data, selected }: { data: TrafficData; selected: string }) {
  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Traffic</h1>
        <p className="mt-1 text-sm text-white/40">
          First-party beacon, bots excluded. Vercel Web Analytics was removed from aisotools on 2026-11-06 to cut
          cost, so use this tab instead.
        </p>
        <p className="mt-0.5 text-xs text-white/30">
          real visitors = distinct sessions, not bots · days in PT · 7d/30d rolling · cached 5 min
          {data.ok ? ` · queried ${when(data.generatedAt)}` : ""}
        </p>
      </div>
      <Link href="/" className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
        ← Mission Control
      </Link>
    </div>
  );

  if (!data.ok) {
    return (
      <main className="mx-auto max-w-[1500px] p-6">
        {header}
        <Card title="No data">
          <p className="text-sm text-white/50">Could not read analytics.events: {data.error}</p>
        </Card>
      </main>
    );
  }

  const d = data.detail;
  const total = d.daily.slice(0, -1).reduce((a, p) => a + p.visitors, 0);
  const full = Math.max(1, d.daily.length - 1);

  return (
    <main className="mx-auto max-w-[1500px] p-6">
      {header}
      <div className="space-y-4">
        <Card title="All sites — real visitors" right="click a site to drill in">
          <SummaryTable sites={data.sites} selected={selected} />
        </Card>

        <Card
          title={`${d.site} — daily real visitors, 30 days`}
          right={`avg ${fmt(Math.round(total / full))}/day over full days · *today is partial`}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {data.sites.map((s) => (
              <Link
                key={s.site}
                href={`/traffic?site=${s.site}`}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  s.site === selected
                    ? "border-sky-400/50 bg-sky-400/10 text-sky-200"
                    : "border-white/15 text-white/60 hover:bg-white/5"
                }`}
              >
                {s.site}
              </Link>
            ))}
          </div>
          <DailyChart days={d.daily} />
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TopList title="Top pages" rows={d.pages} />
          <TopList title="Top referrers" rows={d.referrers} />
          <TopList title="Top countries" rows={d.countries} />
          <TopList title="Top utm_source" rows={d.utmSources} />
        </div>
      </div>
    </main>
  );
}
