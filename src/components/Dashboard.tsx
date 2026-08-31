"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Priority } from "@/lib/data";
import type { DashboardData } from "@/lib/source";

const OWNER_LABEL: Record<Priority["owner"], string> = {
  shib: "SHIB",
  billybob: "BB",
};

const STATUS_STYLE: Record<Priority["status"], string> = {
  open: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  doing: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  blocked: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  done: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

const IDEA_STYLE: Record<string, string> = {
  candidate: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  "candidate-unverified": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  parked: "bg-white/10 text-white/50 ring-white/15",
  rejected: "bg-rose-500/15 text-rose-300/80 ring-rose-500/30",
};

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

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function ago(iso?: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Age of the pushed snapshot, loud enough that stale is never read as current.
 * Anything past 15 minutes means the Mac's 5-minute pusher has missed at least
 * two runs, so the number on screen is no longer describing right now.
 */
function Freshness({ generatedAt, source }: { generatedAt: string | null; source: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (source === "local") {
    return (
      <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
        LIVE · local filesystem
      </span>
    );
  }

  const ms = generatedAt ? Date.now() - new Date(generatedAt).getTime() : Infinity;
  const min = Math.floor(ms / 60_000);
  const tone =
    ms < 15 * 60_000
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : ms < 60 * 60_000
        ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
        : "bg-rose-500/20 text-rose-200 ring-rose-500/40";

  const label = !generatedAt
    ? "NO SNAPSHOT YET"
    : min < 1
      ? "snapshot < 1m old"
      : min < 90
        ? `snapshot ${min}m old`
        : `snapshot ${Math.round(min / 60)}h old`;

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${tone}`}>
      {ms >= 15 * 60_000 ? `⚠ STALE — ${label}` : label}
    </span>
  );
}

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [items, setItems] = useState<Priority[]>(initial.snapshot?.priorities.items ?? []);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dragIndex = useRef<number | null>(null);
  const snap = data.snapshot;

  const save = useCallback(async (next: Priority[]) => {
    setSaving("saving");
    try {
      const res = await fetch("/api/priorities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: next }),
      });
      setSaving(res.ok ? "saved" : "error");
    } catch {
      setSaving("error");
    }
  }, []);

  const commit = useCallback(
    (next: Priority[]) => {
      setItems(next);
      void save(next);
    },
    [save]
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = items.slice();
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    commit(next);
  };

  const setStatus = (id: string, status: Priority["status"]) =>
    commit(
      items.map((i) => (i.id === id ? { ...i, status, updatedAt: new Date().toISOString() } : i))
    );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as DashboardData;
    setData(next);
    // Only adopt the server's ranking when it is newer than what is on screen,
    // so a poll landing mid-drag cannot undo the reorder we just saved.
    setItems((cur) => {
      const remote = next.snapshot?.priorities;
      if (!remote) return cur;
      const a = Date.parse(data.snapshot?.priorities.lastUpdated ?? "") || 0;
      const b = Date.parse(remote.lastUpdated ?? "") || 0;
      return b > a ? remote.items : cur;
    });
  }, [data.snapshot?.priorities.lastUpdated]);

  useEffect(() => {
    const t = setInterval(refresh, 120_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!snap) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="text-2xl font-semibold">Mission Control</h1>
        <p className="mt-4 text-sm text-white/50">
          No snapshot has been pushed yet. The Mac uploads one every 5 minutes via
          <code className="mx-1 rounded bg-white/10 px-1">scripts/push-snapshot.mjs</code>; if this
          persists, that job is not running.
        </p>
      </main>
    );
  }

  const m = snap.money;

  // Done items are hidden from the ranked list, so the visible position number
  // has to be counted over active items only — otherwise the list reads
  // "1, 3, 4" wherever a completed item sits in the underlying array.
  const activeRank = new Map<string, number>();
  for (const it of items) {
    if (it.status !== "done") activeRank.set(it.id, activeRank.size + 1);
  }
  const activeCount = activeRank.size;
  const doneCount = items.length - activeCount;

  // Optional so a snapshot pushed before the ideas panel existed still renders.
  const ideas = snap.ideas?.items ?? [];
  const note = snap.ideas?.note;

  return (
    <main className="mx-auto max-w-[1500px] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Mission Control</h1>
            <Freshness generatedAt={data.generatedAt} source={data.source} />
          </div>
          <p className="mt-1 text-sm text-white/40">
            collected {ago(data.generatedAt)} on {snap.root} · watchdog {ago(m?.generatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">{money(m?.totalMrr ?? 0)}</div>
            <div className="text-xs text-white/40">portfolio MRR (subscriptions)</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">{money(m?.totalCash30d ?? 0)}</div>
            <div className="text-xs text-white/40">cash collected 30d</div>
          </div>
          <button
            onClick={refresh}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------------- Priorities: the ranked list ---------------- */}
        <div className="lg:col-span-2">
          <Card
            title={`Priorities — drag to rank (${activeCount} open)`}
            right={
              <span>
                {snap.priorities.authoritative ? "authoritative" : "advisory"} ·{" "}
                {saving === "saving"
                  ? "saving…"
                  : saving === "saved"
                    ? "saved"
                    : saving === "error"
                      ? "SAVE FAILED"
                      : "memory/priorities.json"}
              </span>
            }
          >
            <ol className="space-y-2">
              {/* Completed items drop out of the ranked list into the Done
                  section below — a finished item isn't a priority, and it was
                  pushing live work down the page. `i` stays the index into the
                  full `items` array so drag/move/save keep working unchanged. */}
              {items.map((it, i) => (it.status === "done" ? null : (
                <li
                  key={it.id}
                  draggable
                  onDragStart={() => (dragIndex.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex.current !== null) move(dragIndex.current, i);
                    dragIndex.current = null;
                  }}
                  className="group cursor-grab rounded-lg border border-white/10 bg-white/[0.03] p-3 active:cursor-grabbing"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-white/30">
                      {activeRank.get(it.id)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{it.title}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_STYLE[it.status]}`}
                        >
                          {it.status}
                        </span>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/60">
                          {OWNER_LABEL[it.owner]}
                        </span>
                      </div>
                      {it.why ? (
                        <p className="mt-1 text-xs leading-relaxed text-white/50">{it.why}</p>
                      ) : null}
                      {it.note ? (
                        <p className="mt-1 text-xs italic text-white/35">{it.note}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex gap-1">
                        <button
                          onClick={() => move(i, i - 1)}
                          className="rounded border border-white/10 px-1.5 text-xs text-white/50 hover:bg-white/10"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => move(i, i + 1)}
                          className="rounded border border-white/10 px-1.5 text-xs text-white/50 hover:bg-white/10"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </div>
                      <select
                        value={it.status}
                        onChange={(e) => setStatus(it.id, e.target.value as Priority["status"])}
                        className="rounded border border-white/10 bg-transparent px-1 py-0.5 text-[11px] text-white/60"
                      >
                        <option value="open">open</option>
                        <option value="doing">doing</option>
                        <option value="blocked">blocked</option>
                        <option value="done">done</option>
                      </select>
                    </div>
                  </div>
                </li>
              )))}
            </ol>
            {items.length === 0 ? (
              <p className="text-sm text-white/40">No priorities in memory/priorities.json yet.</p>
            ) : activeCount === 0 ? (
              <p className="text-sm text-white/40">Everything is done. Nothing ranked.</p>
            ) : null}

            {doneCount > 0 ? (
              <details className="mt-4 rounded-lg border border-white/10 bg-white/[0.02]">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                  Done · {doneCount}
                </summary>
                <ul className="space-y-1 px-3 pb-3">
                  {items.map((it, i) => (it.status !== "done" ? null : (
                    <li
                      key={it.id}
                      className="flex items-start gap-2 rounded border border-white/5 bg-white/[0.02] p-2"
                    >
                      <span className="mt-0.5 text-emerald-400/70">✓</span>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-white/45 line-through decoration-white/20">
                          {it.title}
                        </span>
                        {it.note ? (
                          <p className="mt-0.5 text-[11px] italic text-white/25">{it.note}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/40">
                        {OWNER_LABEL[it.owner]}
                      </span>
                      {/* Reopening puts it straight back into the ranked list
                          at its original position — nothing is lost by marking
                          something done too early. */}
                      <select
                        value={it.status}
                        onChange={(e) => setStatus(it.id, e.target.value as Priority["status"])}
                        className="shrink-0 rounded border border-white/10 bg-transparent px-1 py-0.5 text-[11px] text-white/40"
                      >
                        <option value="open">open</option>
                        <option value="doing">doing</option>
                        <option value="blocked">blocked</option>
                        <option value="done">done</option>
                      </select>
                    </li>
                  )))}
                </ul>
              </details>
            ) : null}
          </Card>
        </div>

        {/* ---------------- Money / funnel ---------------- */}
        <Card title="MRR & funnel" right={m ? `${m.totalEvents.toLocaleString()} beacon events` : ""}>
          <div className="space-y-3">
            {(m?.properties ?? []).map((p) => (
              <div key={p.name} className="rounded-lg border border-white/10 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular-nums">
                    {money(p.mrr)}
                    <span className="ml-1 text-xs text-white/40">
                      {p.activeSubs} sub{p.activeSubs === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-white/50">
                  <div>
                    sessions 7d <span className="tabular-nums text-white/80">{p.sessions7d}</span>
                  </div>
                  <div>
                    bot share <span className="tabular-nums text-white/80">{pct(p.botShare7d)}</span>
                  </div>
                  <div>
                    checkout 7d{" "}
                    <span className="tabular-nums text-white/80">
                      {p.checkoutStarts7d} ({pct(p.startRate7d)})
                    </span>
                  </div>
                  <div>
                    paid 7d <span className="tabular-nums text-white/80">{p.paid7d}</span>
                  </div>
                  <div>
                    cash 30d <span className="tabular-nums text-white/80">{money(p.cash30d)}</span>
                  </div>
                </dl>
                {p.errors.length ? (
                  <p className="mt-2 text-xs text-rose-300">{p.errors.join("; ")}</p>
                ) : null}
              </div>
            ))}
            {m?.trend?.length ? (
              <p className="text-xs text-white/40">
                MRR {m.trend.length}d: {m.trend.map((t) => t.mrr.toFixed(0)).join(" → ")}
              </p>
            ) : null}
          </div>
        </Card>

        {/* ---------------- Sprints ---------------- */}
        <Card title="Sprints" right={`work ${ago(snap.sprints.work.lastUpdated)}`}>
          <div className="mb-3 text-xs">
            <div className="mb-1 text-white/40">
              work-sprint · slot {snap.sprints.work.index} of {snap.sprints.work.slots.length}
            </div>
            <div className="flex flex-wrap gap-1">
              {snap.sprints.work.slots.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className={`rounded px-1.5 py-0.5 ${
                    i === snap.sprints.work.index
                      ? "bg-amber-500/20 text-amber-200"
                      : "bg-white/5 text-white/50"
                  }`}
                >
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-2 text-white/40">
              coding-sprint · next{" "}
              <span className="text-white/70">{snap.sprints.coding.next ?? "—"}</span> · last{" "}
              {snap.sprints.coding.last ?? "—"} ({ago(snap.sprints.coding.lastUpdated)})
            </div>
            {snap.sprints.work.paused.length ? (
              <div className="mt-1 text-rose-300">
                paused: {snap.sprints.work.paused.join(", ")}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            {snap.sprints.recent.slice(0, 10).map((r, i) => (
              <div key={`${r.ts}-${i}`} className="flex items-baseline gap-2 text-xs">
                <span
                  className={`w-5 shrink-0 rounded text-center font-semibold tabular-nums ${
                    r.score >= 3
                      ? "bg-emerald-500/20 text-emerald-300"
                      : r.score === 2
                        ? "bg-sky-500/20 text-sky-300"
                        : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {r.score}
                </span>
                <span className="truncate text-white/70">{r.sprint_type}</span>
                <span className="ml-auto shrink-0 text-white/30">{ago(r.ts)}</span>
              </div>
            ))}
          </div>
          <details className="mt-3 text-xs text-white/50">
            <summary className="cursor-pointer text-white/40">mean score by type</summary>
            <div className="mt-2 space-y-1">
              {snap.sprints.typeScores.map((t) => (
                <div key={t.type} className="flex justify-between gap-2">
                  <span className="truncate">{t.type}</span>
                  <span className="tabular-nums">
                    {t.mean.toFixed(2)} <span className="text-white/30">×{t.fires}</span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        </Card>

        {/* ---------------- Shib-blocked ---------------- */}
        <Card title="Needs Shib" right={`${snap.blockers.length} items`}>
          <div className="space-y-2 text-xs">
            {snap.blockers.map((b, i) => (
              <div key={i} className="rounded border border-white/10 p-2">
                <div className="font-medium text-white/80">{b.title}</div>
                <div className="text-white/40">{b.section}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* ---------------- Repo health ---------------- */}
        <Card title="Repos" right="unpushed / dirty">
          <div className="space-y-1 text-xs">
            {snap.repos.map((r) => (
              <div key={r.repo} className="flex items-baseline gap-2">
                <span className="w-36 shrink-0 truncate text-white/70">{r.repo}</span>
                <span
                  className={`tabular-nums ${r.unpushed > 0 ? "text-amber-300" : "text-white/30"}`}
                >
                  ↑{r.unpushed}
                </span>
                <span className="tabular-nums text-white/30">±{r.dirtyFiles}</span>
                <span className="ml-auto shrink-0 text-white/30">{ago(r.lastCommitAt)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ---------------- Research ---------------- */}
        <Card title="Research threads" right={`${snap.research.openCount} open`}>
          <div className="space-y-1 text-xs">
            {snap.research.threads.map((t) => (
              <div key={t.id} className="flex gap-2">
                <span className="w-8 shrink-0 tabular-nums text-white/30">#{t.id}</span>
                <span className={t.verdict ? "text-white/35 line-through" : "text-white/70"}>
                  {t.title}
                </span>
                {t.high ? (
                  <span className="ml-auto shrink-0 text-amber-300">HIGH</span>
                ) : t.verdict ? (
                  <span className="ml-auto shrink-0 text-white/30">{t.verdict}</span>
                ) : t.blocked ? (
                  <span className="ml-auto shrink-0 text-rose-300">re-scope</span>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        {/* ---------------- Idea backlog ----------------
            Kept out of the ranked priorities list on purpose: an idea is not a
            commitment, and mixing the two is what pushed live work down the
            page before. `ideas` is optional because a snapshot pushed before
            this panel existed will not carry the key. */}
        {ideas.length ? (
          <Card
            title="Idea backlog"
            right={`${ideas.filter((i) => i.verdict.startsWith("candidate")).length} live · memory/app-ideas.json`}
          >
            <div className="space-y-2 text-xs">
              {ideas.map((idea) => (
                <details
                  key={idea.id}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-2"
                >
                  <summary className="flex cursor-pointer select-none items-center gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${
                        IDEA_STYLE[idea.verdict] ?? IDEA_STYLE.parked
                      }`}
                    >
                      {idea.verdict}
                    </span>
                    <span
                      className={
                        idea.verdict === "rejected"
                          ? "text-white/35 line-through decoration-white/20"
                          : "text-white/80"
                      }
                    >
                      {idea.title}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1 border-t border-white/5 pt-2 text-white/50">
                    {idea.evidence ? <p>{idea.evidence}</p> : null}
                    {idea.risk ? <p className="text-rose-300/70">Risk: {idea.risk}</p> : null}
                    {idea.nextStep ? (
                      <p className="text-white/70">Next: {idea.nextStep}</p>
                    ) : null}
                    {idea.source ? (
                      <p className="text-[11px] italic text-white/25">{idea.source}</p>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
            {note ? <p className="mt-3 text-[11px] italic text-white/30">{note}</p> : null}
          </Card>
        ) : null}
      </div>
    </main>
  );
}
