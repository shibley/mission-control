"use client";

import Link from "next/link";
import type { Verdict } from "@/lib/research";
import type { ShopifyApp, ShopifyTab } from "@/lib/shopify";
import type { DashboardData } from "@/lib/source";

const VERDICT_STYLE: Record<Verdict, string> = {
  REPLICATE: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  PARTIAL: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  NO: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

const QUEUE_STYLE: Record<string, string> = {
  pending: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  "in-progress": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  done: "bg-white/10 text-white/40 ring-white/15",
};

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

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${style}`}>{label}</span>
  );
}

function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Bar({ label, n, target }: { label: string; n: number; target: number }) {
  const pct = target ? Math.min(100, (n / target) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-white/60">{label}</span>
        <span className="font-semibold tabular-nums">
          {n}/{target}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-white/10">
        <div
          className={`h-full rounded ${n >= target ? "bg-emerald-400" : "bg-sky-400"}`}
          style={{ width: `${Math.max(pct, n ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
      <div className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="text-[11px] text-white/40">{label}</div>
    </div>
  );
}

function AppCard({ app }: { app: ShopifyApp }) {
  const l = app.listing;
  // A 429 on the latest refetch is our poll rate, not the listing going down —
  // only a non-200/non-429 answer reads as not live.
  const live = l.httpStatus === 200 && (!l.lastAttempt?.status || [200, 429].includes(l.lastAttempt.status));
  const g = app.gate;
  return (
    <Card
      title={app.name}
      right={
        <span className="font-mono">
          {app.repo} · {app.handle}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-2 text-sm">
        <Badge
          label={live ? "LIVE" : (l.lastAttempt?.status ?? l.httpStatus) ? `HTTP ${l.lastAttempt?.status ?? l.httpStatus}` : "UNREACHABLE"}
          style={live ? VERDICT_STYLE.REPLICATE : VERDICT_STYLE.NO}
        />
        <a href={l.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
          {l.url.replace(/^https:\/\//, "")}
        </a>
      </div>
      {l.title ? <p className="mb-1 text-xs text-white/50">{l.title}</p> : null}
      <p className="mb-3 text-[11px] text-white/35">
        listing read {when(l.fetchedAt)} (refetched at most every 6h — Shopify 429s a 5-min poller)
        {l.lastAttempt?.error && l.fetchedAt ? (
          <span className="text-amber-300/80"> · last refetch {when(l.lastAttempt.at)} failed: {l.lastAttempt.error}</span>
        ) : null}
      </p>
      {l.error ? <p className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">listing: {l.error}</p> : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="price" value={l.prices.length ? l.prices.join(" · ") : "—"} />
        <Stat
          label="reviews"
          value={l.reviews ?? "—"}
          tone={l.reviews ? "text-emerald-300" : "text-white/70"}
        />
        <Stat label="rating" value={l.rating != null ? `${l.rating.toFixed(1)}★` : "—"} />
        <Stat label="approved (listing “Launched”)" value={l.launched ?? "—"} />
      </div>

      {g ? (
        <div className="mb-4 rounded-lg border border-white/10 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-white/70 uppercase">
              {g.days}-day kill gate — both bars by {g.deadline ?? "?"}
            </h3>
            <span className="text-xs">
              <span className="font-semibold tabular-nums text-amber-300">{g.daysLeft ?? "?"}</span>
              <span className="text-white/40"> days left</span>
            </span>
          </div>
          <div className="space-y-3">
            <Bar label="merchant installs (ever, excl. dev / Shopify-review / sandbox)" n={g.installs.n} target={g.installs.target} />
            <Bar label="active $29/mo subscriptions" n={g.subscriptions.n} target={g.subscriptions.target} />
          </div>
          <p className="mt-2 text-[11px] text-white/35">
            install meter run {when(g.meterAt)}
            {g.installedNow != null ? ` · ${g.installedNow} merchant store(s) installed right now` : ""}
          </p>
          {g.error ? <p className="mt-1 text-xs text-rose-300">{g.error}</p> : null}
        </div>
      ) : (
        <p className="mb-4 text-xs text-white/40">No install meter wired for this app yet (METERS in src/lib/shopify.ts).</p>
      )}

      <h3 className="mb-1 text-xs font-semibold text-white/50">Last {app.sprints.length} sprint results</h3>
      <ul className="space-y-1">
        {app.sprints.map((s, i) => (
          <li key={`${s.ts}-${i}`} className="flex gap-2 text-xs">
            <span
              className={`w-6 shrink-0 text-right font-semibold tabular-nums ${
                s.score < 0 ? "text-rose-300" : s.score >= 3 ? "text-emerald-300" : "text-white/70"
              }`}
            >
              {Number.isNaN(s.score) ? "?" : s.score}
            </span>
            <span className="w-28 shrink-0 tabular-nums text-white/40">{when(s.ts)}</span>
            <span className="text-white/60">
              {s.commit ? <span className="mr-1 font-mono text-white/35">{s.commit}</span> : null}
              {s.shipped ?? "—"}
            </span>
          </li>
        ))}
        {!app.sprints.length ? <li className="text-xs text-white/50">No sprint rows.</li> : null}
      </ul>
    </Card>
  );
}

/** Queue items open with a bold headline and run on for a paragraph; show the headline. */
function headline(title: string) {
  return (title.match(/\*\*([^*]+)\*\*/)?.[1] ?? title).replace(/[*`]/g, "").trim();
}

export default function ShopifyApps({ initial }: { initial: DashboardData }) {
  // Absent on any snapshot pushed before this tab existed — read as "no data".
  const s = (initial.snapshot as { shopifyTab?: ShopifyTab } | null)?.shopifyTab;
  const local = initial.source === "local";

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Shopify apps</h1>
        <p className="mt-1 text-sm text-white/40">
          read-only · apps discovered from */shopify.app.toml, listing fetched live, gate from the install
          meter&apos;s ledger · {local ? "request" : "snapshot"} time
          {initial.generatedAt ? ` · collected ${when(initial.generatedAt)}` : ""}
        </p>
      </div>
      <Link href="/" className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
        ← Mission Control
      </Link>
    </div>
  );

  if (!s) {
    return (
      <main className="mx-auto max-w-[1500px] p-6">
        {header}
        <Card title="No data">
          <p className="text-sm text-white/50">
            The snapshot carries no Shopify section — the Mac has not pushed since this tab was added.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1500px] p-6">
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {s.apps.map((a) => (
            <AppCard key={a.handle} app={a} />
          ))}
          {!s.apps.length ? (
            <Card title="No apps">
              <p className="text-sm text-white/50">No shopify.app.toml found under ~/clawd.</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Next app candidates" right="agentic-replication-log.md">
            <h3 className="mb-1 text-xs font-semibold text-white/50">Research queue</h3>
            <ul className="mb-4 space-y-2">
              {s.candidates.queue.map((q, i) => (
                <li key={`${q.title}-${i}`} className={`text-sm ${q.state === "done" ? "text-white/35" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <Badge label={q.state.toUpperCase()} style={QUEUE_STYLE[q.state]} />
                    <span>{headline(q.title)}</span>
                  </div>
                  {q.note ? <p className="ml-1 mt-0.5 text-[11px] text-white/40">{q.note}</p> : null}
                </li>
              ))}
              {!s.candidates.queue.length ? <li className="text-xs text-white/50">No Shopify items queued.</li> : null}
            </ul>

            <h3 className="mb-1 text-xs font-semibold text-white/50">Verdicts</h3>
            <ul className="space-y-2">
              {s.candidates.entries.map((e, i) => (
                <li key={`${e.date}-${e.company}-${i}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {e.verdict ? <Badge label={e.verdict} style={VERDICT_STYLE[e.verdict]} /> : null}
                    <span className="text-xs font-medium">{e.company}</span>
                    <span className="text-[11px] text-white/35">{e.date ?? "undated"}</span>
                  </div>
                  {e.reason ? <p className="mt-1 text-[11px] text-white/55">{e.reason}</p> : null}
                  {e.decision ? <p className="mt-1 text-[11px] font-medium text-amber-300/90">{e.decision}</p> : null}
                </li>
              ))}
              {!s.candidates.entries.length ? <li className="text-xs text-white/50">No Shopify verdicts yet.</li> : null}
            </ul>
          </Card>
        </div>
      </div>
    </main>
  );
}
