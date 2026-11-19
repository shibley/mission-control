"use client";

import { useState } from "react";
import type { GoalRow, GoalStep, GoalWindow, NewlyUpGoal } from "@/lib/newlyupGoal";

// Goal panel at the top of /newlyup (Shib 2026-11-19): 10 paying clients = proof, then 100; Dec 3 checkpoint = 3+.
const GOAL = 10;
const LONG = 100;
const GOAL_BY = Date.parse("2026-12-31T23:59:59-08:00");
const CHECKPOINT = { at: Date.parse("2026-12-03T23:59:59-08:00"), need: 3 };
const WEEK = 7 * 864e5;

const STEPS: { k: keyof Omit<GoalRow, "source">; label: string }[] = [
  { k: "leads", label: "Leads" },
  { k: "replied", label: "Replied" },
  { k: "previewSent", label: "Preview" },
  { k: "previewOpened", label: "Opened" },
  { k: "cardSaved", label: "Card" },
  { k: "paid", label: "Paid" },
];

const ago = (iso: string | null, now: number) => {
  if (!iso) return null;
  const m = Math.round((now - Date.parse(iso)) / 60e3);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })
    : "—";

function Fold({ title, count, open, onToggle, children }: { title: string; count?: string | number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-black/10">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className={`inline-block w-3 text-white/40 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/75">
          {title} {count != null ? <span className="font-normal tabular-nums text-white/40">· {count}</span> : null}
        </span>
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  );
}

function Cell({ v, prev }: { v: GoalStep; prev: GoalStep }) {
  if (v === "n/a") return <div className="text-[11px] text-white/25">n/a</div>;
  if (v == null) return <div className="text-[10px] leading-tight text-white/35">not tracked</div>;
  const pct = typeof prev === "number" && prev > 0 ? Math.round((v / prev) * 100) : null;
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums">{v}</div>
      <div className="text-[10px] tabular-nums text-white/35">{pct == null ? " " : `${pct}%`}</div>
    </div>
  );
}

function FunnelRow({ r }: { r: GoalRow }) {
  // % is against the nearest earlier step that has a number (n/a / not tracked steps are skipped).
  const prevs = STEPS.map((_, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const p = r[STEPS[j].k];
      if (typeof p === "number") return p;
    }
    return null;
  });
  return (
    <div className="border-t border-white/5 py-2">
      <div className="mb-1 text-xs font-medium text-white/70">{r.source}</div>
      <div className="grid grid-cols-6 gap-1 text-center">
        {STEPS.map(({ k }, i) => (
          <Cell key={k} v={r[k]} prev={prevs[i]} />
        ))}
      </div>
    </div>
  );
}

export default function NewlyUpGoalPanel({ goal }: { goal: NewlyUpGoal | null | undefined }) {
  const [win, setWin] = useState<GoalWindow>("7");
  const [open, setOpen] = useState<Record<string, boolean>>({ funnel: true });
  const [now] = useState(() => Date.now());
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (goal === undefined) return null; // snapshot predates the panel
  if (goal === null)
    return <section className="rounded-xl border border-rose-400/30 p-3 text-sm text-rose-200">Goal: freesite.db unreadable in this snapshot.</section>;

  const paying = goal.paying;
  const weeksLeft = Math.max((GOAL_BY - now) / WEEK, 0.1);
  const needPerWeek = paying == null ? null : Math.max(GOAL - paying, 0) / weeksLeft;
  const last7 = goal.payingDates.filter((d) => now - Date.parse(d) < WEEK).length;
  const sinceWeeks = goal.startedAt ? Math.max((now - Date.parse(goal.startedAt)) / WEEK, 1) : null;
  const avg = paying != null && sinceWeeks ? paying / sinceWeeks : null;
  const daysToCp = Math.ceil((CHECKPOINT.at - now) / 864e5);
  const cpMet = paying != null && paying >= CHECKPOINT.need;
  const cpLabel =
    paying == null
      ? "Stripe not read"
      : cpMet
        ? `on track (${paying}/${CHECKPOINT.need})`
        : daysToCp >= 0
          ? `${paying}/${CHECKPOINT.need} · need ${CHECKPOINT.need - paying} more in ${daysToCp}d`
          : `missed (${paying}/${CHECKPOINT.need})`;
  const pct = (n: number, of: number) => `${Math.min(100, (n / of) * 100)}%`;

  const bySource = (xs: { source: string }[]) =>
    Object.entries(xs.reduce<Record<string, number>>((a, x) => ((a[x.source] = (a[x.source] || 0) + 1), a), {}))
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s} ${n}`)
      .join(" · ");

  return (
    <section className="space-y-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">Goal</h2>
        <span className="text-[11px] text-white/35">
          Stripe {goal.stripeAt ? ago(goal.stripeAt, now) : "—"}
          {goal.stripeError ? <span className="text-rose-300"> · {goal.stripeError}</span> : null}
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <span className="text-3xl font-semibold tabular-nums">{paying ?? "?"}</span>
          <span className="text-lg text-white/40 tabular-nums"> / {GOAL}</span>
          <span className="ml-2 text-xs text-white/45">paying clients</span>
        </div>
        <div className="text-right">
          <span className="text-xl font-semibold tabular-nums">{goal.mrr == null ? "?" : `$${goal.mrr.toLocaleString()}`}</span>
          <span className="ml-1 text-xs text-white/45">MRR</span>
        </div>
      </div>

      {/* Bar to 10 (proof), then a thin 0–100 bar with the 10 marked. */}
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: pct(paying ?? 0, GOAL) }} />
      </div>
      <div className="relative h-1.5 rounded-full bg-white/5">
        <div className="h-full rounded-full bg-emerald-400/60" style={{ width: pct(paying ?? 0, LONG) }} />
        <div className="absolute -top-0.5 h-2.5 w-px bg-white/50" style={{ left: "10%" }} />
        <div className="absolute -top-0.5 right-0 h-2.5 w-px bg-white/50" />
      </div>
      <div className="relative h-3 text-[10px] leading-3 text-white/35 tabular-nums">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: "10%" }}>{GOAL}</span>
        <span className="absolute right-0">{LONG}</span>
      </div>

      <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
        <div className="rounded-md bg-white/[0.03] px-2.5 py-1.5">
          <span className="text-white/45">Pace to {GOAL} by Dec 31: </span>
          <span className="font-semibold tabular-nums">{needPerWeek == null ? "?" : needPerWeek.toFixed(1)}/wk needed</span>
          <span className="text-white/45"> ({weeksLeft.toFixed(1)} wks left)</span>
          <div className="text-white/45">
            actual: <span className="font-semibold text-white/80 tabular-nums">{last7}</span> in last 7d
            {avg != null ? <> · <span className="tabular-nums">{avg.toFixed(1)}</span>/wk since {day(goal.startedAt)}</> : null}
          </div>
        </div>
        <div className={`rounded-md px-2.5 py-1.5 ${cpMet ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>
          <span className="opacity-70">Dec 3 checkpoint (3+ paying): </span>
          <span className="font-semibold">{cpLabel}</span>
        </div>
      </div>

      <Fold title="Funnel" count={`${win === "all" ? "all time" : `last ${win}d`}`} open={!!open.funnel} onToggle={() => toggle("funnel")}>
        <div className="mb-2 flex gap-1">
          {(["7", "30", "all"] as GoalWindow[]).map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`rounded px-2.5 py-1 text-xs ${win === w ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40" : "bg-white/5 text-white/50"}`}
            >
              {w === "all" ? "All" : `${w}d`}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1 text-center text-[10px] text-white/40 uppercase">
          {STEPS.map((s) => (
            <div key={s.k} className="truncate">{s.label}</div>
          ))}
        </div>
        {goal.funnel[win].map((r) => (
          <FunnelRow key={r.source} r={r} />
        ))}
        <p className="mt-2 text-[10px] leading-snug text-white/35">
          FB/site-form: leads created in the window and how far each got (a later step counts the earlier ones). Email: Instantly
          contacted + human replies (auto-replies excluded) in the window
          {goal.instantlyAt ? `, read ${ago(goal.instantlyAt, now)}` : ""}
          {goal.instantlyError ? ` — ${goal.instantlyError}` : ""}; card/paid from Stripe refs. Opened = a non-bot preview view
          (can include our own). C1/C2 emails carry no preview (n/a). % = vs the previous counted step.
        </p>
      </Fold>

      <Fold title="Paying clients by source" count={goal.clients.length ? bySource(goal.clients) : 0} open={!!open.clients} onToggle={() => toggle("clients")}>
        {goal.clients.length === 0 ? (
          <p className="text-xs text-white/40">None yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {goal.clients.map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {c.name} <span className="text-xs text-white/40">· {c.source}</span>
                  {c.note ? <span className="block text-[11px] text-amber-300">{c.note}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-white/50 tabular-nums">
                  {c.amount == null ? "" : `$${c.amount}/mo · `}since {day(c.since)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Fold>

      <Fold title="Warm leads by source" count={goal.warm.length ? `${goal.warm.length} · ${bySource(goal.warm)}` : 0} open={!!open.warm} onToggle={() => toggle("warm")}>
        {goal.warm.length === 0 ? (
          <p className="text-xs text-white/40">None.</p>
        ) : (
          <ul className="space-y-1">
            {goal.warm.map((w, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {w.name} <span className="text-xs text-white/40">· {w.source}</span>
                </span>
                <span className="shrink-0 text-[11px] text-white/45">
                  {w.stage} · {day(w.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-white/35">Warm = engaged, price quoted or card saved and not paying; email replies classed buy/positive/price/question.</p>
      </Fold>
    </section>
  );
}
