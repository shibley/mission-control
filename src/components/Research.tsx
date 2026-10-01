"use client";

import Link from "next/link";
import type { ResearchTab, Verdict } from "@/lib/research";
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

const PRIORITY_RANK: Record<string, number> = { HIGHEST: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
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
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${style}`}>
      {label}
    </span>
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

/** Doc paths are written as "memory/x.md"; only the local server can serve them. */
function DocLink({ doc, local }: { doc: string; local: boolean }) {
  const file = doc.split("/").pop() ?? doc;
  if (!local || !/\.md$/.test(file)) return <code className="text-white/40">{doc}</code>;
  return (
    <a
      href={`/api/research/doc?f=${encodeURIComponent(file)}`}
      target="_blank"
      rel="noreferrer"
      className="text-sky-300 hover:underline"
    >
      {doc}
    </a>
  );
}

export default function Research({ initial }: { initial: DashboardData }) {
  // Absent on any snapshot pushed before this tab existed — read as "no data".
  const r = (initial.snapshot as { researchTab?: ResearchTab } | null)?.researchTab;
  const local = initial.source === "local";

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Research</h1>
        <p className="mt-1 text-sm text-white/40">
          read-only · parsed from ~/clawd/memory at {local ? "request" : "snapshot"} time
          {initial.generatedAt ? ` · collected ${when(initial.generatedAt)}` : ""}
        </p>
      </div>
      <Link href="/" className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
        ← Mission Control
      </Link>
    </div>
  );

  if (!r) {
    return (
      <main className="mx-auto max-w-[1500px] p-6">
        {header}
        <Card title="No data">
          <p className="text-sm text-white/50">
            The snapshot carries no research section — the Mac has not pushed since this tab was
            added.
          </p>
        </Card>
      </main>
    );
  }

  const awaiting = r.briefs.filter((b) => b.awaiting);
  const queueOpen = r.replication.queue.filter((q) => q.state !== "done");
  const failures = r.cron.runs.filter((x) => x.status !== "ok").length;
  const backlog = r.backlog
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.t.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.t.priority ?? ""] ?? 9) || a.i - b.i
    )
    .map(({ t }) => t);

  return (
    <main className="mx-auto max-w-[1500px] p-6">
      {header}

      {/* ---------------- 2. Urgent: REPLICATE briefs awaiting Shib ---------------- */}
      <div className="mb-4">
        {awaiting.length ? (
          <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-emerald-300 uppercase">
              Urgent — {awaiting.length} REPLICATE brief{awaiting.length > 1 ? "s" : ""} awaiting
              Shib&apos;s decision
            </h2>
            <ul className="space-y-1 text-sm">
              {awaiting.map((b) => (
                <li key={b.file} className="flex flex-wrap items-baseline gap-2">
                  <Badge label="REPLICATE" style={VERDICT_STYLE.REPLICATE} />
                  <span>{b.title}</span>
                  <DocLink doc={`memory/${b.file}`} local={local} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-white/50">
            Urgent ideas: none — no <code>memory/replicate-brief-*.md</code> is awaiting Shib&apos;s
            decision
            {r.briefs.length ? ` (${r.briefs.length} brief${r.briefs.length > 1 ? "s" : ""} already decided)` : ""}.
          </section>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ---------------- 1. Replication log ---------------- */}
          <Card title="Replication research — entries" right={`${r.replication.entries.length} reviewed`}>
            {r.replication.error ? (
              <p className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                {r.replication.error}
              </p>
            ) : null}
            <ul className="space-y-2">
              {r.replication.entries.map((e, i) => (
                <li key={`${e.date}-${e.company}-${i}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {e.verdict ? (
                      <Badge label={e.verdict} style={VERDICT_STYLE[e.verdict]} />
                    ) : (
                      <Badge label="?" style={QUEUE_STYLE.done} />
                    )}
                    <span className="text-sm font-medium">{e.company}</span>
                    <span className="text-xs text-white/35">
                      {e.date ?? "undated"}
                      {e.by ? ` · ${e.by}` : ""}
                    </span>
                  </div>
                  {e.reason ? <p className="mt-1 text-xs text-white/60">{e.reason}</p> : null}
                  {e.doc ? (
                    <p className="mt-1 text-[11px]">
                      <DocLink doc={e.doc} local={local} />
                    </p>
                  ) : null}
                </li>
              ))}
              {!r.replication.entries.length ? <li className="text-sm text-white/50">No entries yet.</li> : null}
            </ul>
          </Card>

          {/* ---------------- 3. Runner health ---------------- */}
          <Card
            title="Research runners — health"
            right={failures ? <span className="text-rose-300">{failures} of last {r.cron.runs.length} failed</span> : "mrr-research"}
          >
            <h3 className="mb-1 text-xs font-semibold text-white/50">
              mrr-research cron · last {r.cron.runs.length} runs{" "}
              <span className="font-mono text-white/25">{r.cron.jobId.slice(0, 8)}</span>
            </h3>
            {r.cron.error ? (
              <p className="mb-2 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">
                could not read runs: {r.cron.error}
              </p>
            ) : null}
            <ul className="mb-4 space-y-1.5">
              {r.cron.runs.map((x, i) => (
                <li key={`${x.at}-${i}`} className="text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge
                      label={x.status.toUpperCase()}
                      style={x.status === "ok" ? VERDICT_STYLE.REPLICATE : VERDICT_STYLE.NO}
                    />
                    <span className="tabular-nums text-white/70">{when(x.at)}</span>
                    {x.durationMs != null ? (
                      <span className="text-white/35">{Math.round(x.durationMs / 1000)}s</span>
                    ) : null}
                    {x.model ? <span className="text-white/35">{x.model}</span> : null}
                  </div>
                  {x.error ? <p className="mt-0.5 text-rose-300">{x.error}</p> : null}
                  {x.summary ? <p className="mt-0.5 text-white/55">{x.summary}</p> : null}
                </li>
              ))}
            </ul>

            <h3 className="mb-1 text-xs font-semibold text-white/50">sprint-eval-log · research fires</h3>
            <ul className="space-y-1">
              {r.evals.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="flex gap-2 text-xs">
                  <span
                    className={`w-6 shrink-0 text-right font-semibold tabular-nums ${
                      e.score < 0 ? "text-rose-300" : e.score >= 3 ? "text-emerald-300" : "text-white/70"
                    }`}
                  >
                    {Number.isNaN(e.score) ? "?" : e.score}
                  </span>
                  <span className="w-28 shrink-0 tabular-nums text-white/40">{when(e.ts)}</span>
                  <span className="text-white/60">
                    {e.sprintType !== "research" ? <span className="mr-1 text-white/35">{e.sprintType}</span> : null}
                    {e.goal ?? "—"}
                  </span>
                </li>
              ))}
              {!r.evals.length ? <li className="text-xs text-white/50">No research rows.</li> : null}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Replication queue" right={`${queueOpen.length} open`}>
            <ul className="space-y-1.5">
              {r.replication.queue.map((q, i) => (
                <li key={`${q.title}-${i}`} className={`text-sm ${q.state === "done" ? "text-white/35" : ""}`}>
                  <div className="flex items-baseline gap-2">
                    <Badge label={q.state.toUpperCase()} style={QUEUE_STYLE[q.state]} />
                    <span>{q.title}</span>
                  </div>
                  {q.note ? <p className="ml-1 mt-0.5 text-[11px] text-white/40">{q.note}</p> : null}
                </li>
              ))}
              {!r.replication.queue.length ? <li className="text-sm text-white/50">Queue empty.</li> : null}
            </ul>
          </Card>

          {/* ---------------- 4. Open backlog ---------------- */}
          <Card title="Open research backlog" right={`${r.backlog.length} threads`}>
            <ul className="max-h-[640px] space-y-1 overflow-y-auto pr-1 text-xs">
              {backlog.map((t) => (
                <li key={t.id} className="text-white/70">
                  <span className="font-mono text-white/40">#{t.id}</span> {t.title}
                  {t.priority ? (
                    <span
                      className={
                        t.priority.startsWith("HIGH")
                          ? "text-rose-300"
                          : t.priority === "MEDIUM"
                            ? "text-amber-300"
                            : "text-white/35"
                      }
                    >
                      {" "}
                      ({t.priority.toLowerCase()})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </main>
  );
}
