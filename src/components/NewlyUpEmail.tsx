"use client";

import { useState } from "react";
import type { EmailCampaignRow, EmailWin, NewlyUpEmail, ReplySplit } from "@/lib/newlyupEmail";

// Email panel under the Goal panel on /newlyup (Shib 2026-11-20). Per Instantly campaign: settings + today's sends,
// totals vs last 7d, replies by freesite's class, C4 preview visits; then inbox capacity, warmup, latest seed test.
const BOUNCE_LINE = 0.02;

const ago = (iso: string | null, now: number) => {
  if (!iso) return null;
  const m = Math.round((now - Date.parse(iso)) / 60e3);
  return m < 60 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

const NT = () => <span className="text-[11px] text-white/35">not tracked</span>;

function Fold({ title, count, open, onToggle, children }: { title: React.ReactNode; count?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
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

function Bounce({ w }: { w: EmailWin }) {
  if (!w) return <NT />;
  const r = w.contacted > 0 ? w.bounced / w.contacted : null;
  return (
    <span className={`tabular-nums ${r != null && r > BOUNCE_LINE ? "font-semibold text-rose-300" : ""}`}>
      {w.bounced}
      {r != null ? ` (${(r * 100).toFixed(1)}%)` : ""}
    </span>
  );
}

function Volume({ c }: { c: EmailCampaignRow }) {
  const rows: { k: string; v: (w: EmailWin) => React.ReactNode }[] = [
    { k: "Contacted", v: (w) => (w ? w.contacted : <NT />) },
    { k: "Emails sent", v: (w) => (w ? w.sent : <NT />) },
    { k: "Bounced", v: (w) => <Bounce w={w} /> },
  ];
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0.5 text-xs">
      <div />
      <div className="text-right text-[10px] text-white/40 uppercase">7d</div>
      <div className="text-right text-[10px] text-white/40 uppercase">Total</div>
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <div className="text-white/50">{r.k}</div>
          <div className="text-right tabular-nums">{r.v(c.d7)}</div>
          <div className="text-right tabular-nums">{r.v(c.all)}</div>
        </div>
      ))}
    </div>
  );
}

const REPLY_COLS: { k: keyof Omit<ReplySplit, "total">; label: string; tone?: string }[] = [
  { k: "interested", label: "Want", tone: "text-emerald-300" },
  { k: "auto", label: "Auto" },
  { k: "decline", label: "Stop" },
  { k: "bounce", label: "Bounce" },
  { k: "other", label: "Other" },
];

function Replies({ c }: { c: EmailCampaignRow }) {
  if (!c.replies) return <div className="text-xs"><NT /></div>;
  return (
    <div>
      <div className="grid grid-cols-5 gap-1 text-center">
        {REPLY_COLS.map((col) => (
          <div key={col.k} className="truncate text-[10px] text-white/40 uppercase">{col.label}</div>
        ))}
        {REPLY_COLS.map((col) => {
          const n = c.replies!.all[col.k];
          return (
            <div key={col.k}>
              <div className={`text-sm font-semibold tabular-nums ${n > 0 && col.tone ? col.tone : ""}`}>{n}</div>
              <div className="text-[10px] text-white/35 tabular-nums">7d {c.replies!.d7[col.k]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Campaign({ c, now }: { c: EmailCampaignRow; now: number }) {
  const tone = c.status === "active" ? "bg-emerald-500/15 text-emerald-200" : c.status === "draft" ? "bg-white/10 text-white/50" : "bg-amber-500/15 text-amber-200";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`}>{c.status}</span>
        <span className="text-white/50">
          limit <span className="text-white/80 tabular-nums">{c.dailyLimit ?? "?"}</span>/day · today{" "}
          <span className="text-white/80 tabular-nums">{c.sentToday ?? "?"}</span>
        </span>
        <span className="w-full text-white/40">
          last send {c.lastSentAt ? `${when(c.lastSentAt)} (${ago(c.lastSentAt, now)})` : "never"}
        </span>
      </div>
      <Volume c={c} />
      <div>
        <div className="mb-1 text-[11px] font-medium text-white/55">
          Replies (freesite class) <span className="font-normal text-white/35">· want = interested, stop = decline/unsubscribe</span>
        </div>
        <Replies c={c} />
      </div>
      {c.label === "C4" ? (
        <div className="rounded-md bg-white/[0.03] px-2.5 py-1.5 text-xs">
          <span className="text-white/50">Preview visits: </span>
          {c.previewVisits ? (
            <>
              <span className="font-semibold tabular-nums">{c.previewVisits.visited}</span>
              <span className="text-white/50"> of {c.previewVisits.recipients} emailed opened their preview</span>
              {c.previewVisits.views ? <span className="text-white/50"> · {c.previewVisits.views} views</span> : null}
              <div className="mt-0.5 text-[10px] leading-snug text-white/35">
                Matched by recipient → their own preview slug (each C4 email links only theirs); non-bot views after the
                email went out, which can include our own checks. Views synced {ago(c.previewVisits.syncedAt, now) ?? "—"}.
              </div>
            </>
          ) : (
            <>
              <NT />
              <div className="mt-0.5 text-[10px] text-white/35">Needs the C4 recipient list from Instantly and freesite preview_views.</div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function NewlyUpEmailPanel({ email }: { email: NewlyUpEmail | null | undefined }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [now] = useState(() => Date.now());
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  if (email === undefined) return null; // snapshot predates the panel
  if (email === null)
    return <section className="rounded-xl border border-rose-400/30 p-3 text-sm text-rose-200">Email: unreadable in this snapshot.</section>;

  const cap = email.capacity;
  const over = cap && cap.inboxCap != null && cap.activeLimits > cap.inboxCap;
  const sentToday = email.campaigns.reduce((a, c) => a + (c.sentToday ?? 0), 0);

  return (
    <section className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-500/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">Email</h2>
        <span className="text-[11px] text-white/35">
          Instantly {email.at ? ago(email.at, now) : "—"}
          {email.error ? <span className="text-rose-300"> · {email.error}</span> : null}
        </span>
      </div>

      {cap ? (
        <div className={`rounded-md px-2.5 py-1.5 text-xs ${over ? "bg-rose-500/15 text-rose-200" : "bg-white/[0.03]"}`}>
          <span className="opacity-70">Capacity: </span>
          <span className="font-semibold tabular-nums">
            {cap.activeLimits}/{cap.inboxCap ?? "?"}
          </span>
          <span className="opacity-70">
            /day (active campaign limits vs {cap.inboxCount} inboxes){over ? " — OVER: campaigns will starve each other" : ""}
          </span>
          {cap.draftLimits ? (
            <div className="opacity-60">
              Drafts would add {cap.draftLimits} → {cap.activeLimits + cap.draftLimits}/{cap.inboxCap ?? "?"}
            </div>
          ) : null}
          <div className="opacity-60">
            Sent today: <span className="tabular-nums">{sentToday}</span>
          </div>
        </div>
      ) : null}

      {email.campaigns.map((c) => {
        const r = c.d7 && c.d7.contacted ? c.d7.bounced / c.d7.contacted : null;
        return (
          <Fold
            key={c.label}
            title={c.label}
            count={
              <>
                {c.status} · {c.sentToday ?? "?"}/{c.dailyLimit ?? "?"} today
                {c.replies?.all.interested ? <span className="text-emerald-300"> · {c.replies.all.interested} interested</span> : null}
                {r != null && r > BOUNCE_LINE ? <span className="text-rose-300"> · bounce {(r * 100).toFixed(1)}%</span> : null}
              </>
            }
            open={!!open[c.label]}
            onToggle={() => toggle(c.label)}
          >
            <div className="mb-2 truncate text-[11px] text-white/40">{c.name}</div>
            <Campaign c={c} now={now} />
          </Fold>
        );
      })}

      <Fold
        title="Deliverability"
        count={email.seed ? `seed test ${email.seed.checked}` : undefined}
        open={!!open.deliv}
        onToggle={() => toggle("deliv")}
      >
        <div className="mb-1 text-[11px] font-medium text-white/55">
          Latest seed test{email.seed ? ` · checked ${email.seed.checked}` : ""}
        </div>
        {email.seed ? (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/65">
            {email.seed.lines.map((l, i) => (
              <li key={i} className={/not verified/i.test(l) ? "text-amber-200" : ""}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs"><NT /></p>
        )}
        <div className="mt-3 mb-1 text-[11px] font-medium text-white/55">Inbox warmup (Instantly warmup pool, not real recipients)</div>
        {email.inboxes ? (
          <ul className="space-y-0.5 text-xs">
            {email.inboxes.map((i) => (
              <li key={i.email} className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 break-all text-white/65">{i.email}</span>
                <span className={`ml-auto tabular-nums ${i.health != null && i.health < 90 ? "text-rose-300" : "text-white/50"}`}>
                  {i.dailyLimit ?? "?"}/day · warmup {i.warmup} · health {i.health ?? "?"}%{i.inboxed ? ` · ${i.inboxed}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs"><NT /></p>
        )}
        <p className="mt-2 text-[10px] leading-snug text-white/35">
          Bounce % = bounced ÷ contacted, red over 2%. Replies use freesite&apos;s classifier (handle-replies), not Instantly&apos;s
          opportunity flag. Open/click tracking is off on every campaign, so opens are not tracked. x/y = warmup emails that
          landed in inbox of those sent.
        </p>
      </Fold>
    </section>
  );
}
