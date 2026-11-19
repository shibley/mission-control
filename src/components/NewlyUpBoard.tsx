"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeadMsg, NewlyUpLead, OutboxItem } from "@/lib/newlyup";

// Lead board + approval queue for /newlyup (Shib "go dashboard", 2026-11-18). Drafts live in freesite.db `outbox`;
// the buttons POST to /api/newlyup/outbox, which only works on the Mac (lib/local-gate). On the Vercel copy
// (`interactive` false) everything renders read-only.

const COLUMNS = [
  "New",
  "Replied",
  "Preview built",
  "Preview sent",
  "Price quoted",
  "Card saved / won",
  "Live",
] as const;
type Column = (typeof COLUMNS)[number] | "Lost / Later";

export function boardColumn(l: NewlyUpLead): Column {
  if (l.live) return "Live";
  if (l.stage === "won" || /^card saved/i.test(l.next_action || ""))
    return "Card saved / won";
  return (
    (
      {
        new: "New",
        replied: "Replied",
        engaged: "Replied",
        "preview-built": "Preview built",
        "preview-sent": "Preview sent",
        "price-quoted": "Price quoted",
      } as Record<string, Column>
    )[l.stage] ?? "Lost / Later"
  );
}

const OPEN = ["pending", "approved", "scheduled", "sending", "held"];
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  scheduled: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  sending: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  held: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  skipped: "bg-white/10 text-white/40 ring-white/15",
};

function day(iso?: string | null) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Pill({ label, style }: { label: string; style?: string }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
        style || "bg-white/10 text-white/60 ring-white/15"
      }`}
    >
      {label}
    </span>
  );
}

function DraftCard({
  item,
  lead,
  interactive,
  compact,
  older = 0,
}: {
  item: OutboxItem;
  lead?: NewlyUpLead;
  interactive: boolean;
  compact?: boolean;
  /** Pending drafts for the same lead hidden behind this one (one draft per lead is shown). */
  older?: number;
}) {
  const router = useRouter();
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editable =
    interactive &&
    ["pending", "approved", "scheduled", "failed", "held"].includes(
      item.status,
    );
  const dirty = text !== item.text;

  async function act(
    action:
      | "approve-now"
      | "approve-suggested"
      | "skip"
      | "save"
      | "send-anyway",
  ) {
    if (
      action === "approve-now" &&
      !confirm(
        `Send this to ${lead?.business || item.lead_key || "this lead"} now?`,
      )
    )
      return;
    if (
      action === "send-anyway" &&
      !confirm(
        `A similar message already went to ${
          lead?.business || item.lead_key || "this lead"
        }. Send this one anyway?`,
      )
    )
      return;
    setBusy(action);
    setErr(null);
    try {
      const r = await fetch("/api/newlyup/outbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, action, text }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Compact = inside a lead row, which is already an <li>: render a <div> there (nested <li> broke hydration).
  const Tag = compact ? "div" : "li";
  return (
    <Tag
      id={compact ? undefined : `outbox-${item.id}`}
      className={`min-w-0 scroll-mt-4 rounded-lg border p-3 ${
        compact
          ? "list-none border-amber-400/25 bg-amber-500/[0.04]"
          : "border-white/10 bg-black/20"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill label={item.status} style={STATUS_STYLE[item.status]} />
        {compact ? (
          <span className="text-[11px] font-semibold uppercase text-amber-200/90">
            suggested reply
          </span>
        ) : (
          <>
            <span className="font-medium text-white/90">
              {lead?.business || item.lead_key || "(no lead)"}
            </span>
            {lead?.contact && lead.contact !== lead.business ? (
              <span className="text-xs text-white/40">{lead.contact}</span>
            ) : null}
          </>
        )}
        <span className="text-[11px] text-white/40">
          #{item.id} · {item.channel}
          {item.created_by ? ` · by ${item.created_by}` : ""}
        </span>
        {older > 0 ? (
          <span
            title="Approving this draft skips the older one(s)"
            className="text-[11px] text-amber-200/70"
          >
            +{older} older draft{older > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!editable}
          rows={
            compact
              ? Math.min(10, Math.max(3, Math.ceil(text.length / 30)))
              : Math.min(12, Math.max(4, text.split("\n").length + 1))
          }
          className="min-h-24 w-full flex-1 rounded-md border border-white/15 bg-white/[0.03] p-2 text-sm leading-relaxed text-white/90 focus:border-sky-400/60 focus:outline-none"
        />
        {item.image_path ? (
          interactive ? (
            <a
              href={`/api/newlyup/outbox/image?path=${encodeURIComponent(
                item.image_path,
              )}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/newlyup/outbox/image?path=${encodeURIComponent(
                  item.image_path,
                )}`}
                alt="attachment"
                className="h-28 w-28 rounded-md border border-white/10 object-cover sm:h-32 sm:w-32"
              />
            </a>
          ) : (
            <div className="shrink-0 break-all text-[11px] text-white/40 sm:w-32">
              image: {item.image_path}
            </div>
          )
        ) : null}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-white/45">
        <div className={compact ? "hidden" : ""}>
          thread:{" "}
          {item.thread_url ? (
            <a
              className="break-all text-sky-300 underline decoration-sky-300/30"
              href={item.thread_url}
              target="_blank"
              rel="noreferrer"
            >
              {item.thread_url}
            </a>
          ) : (
            "— (worker finds the existing chat per the playbook)"
          )}
        </div>
        <div>
          suggested: {when(item.suggested_at)}
          {item.send_at ? ` · sends: ${when(item.send_at)}` : ""}
          {item.sent_at ? ` · sent: ${when(item.sent_at)}` : ""}
        </div>
        {item.error ? <div className="text-rose-300">{item.error}</div> : null}
      </div>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === "held" ? (
            <button
              disabled={!!busy || dirty}
              title={dirty ? "Save the edit first" : undefined}
              onClick={() => act("send-anyway")}
              className="rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {busy === "send-anyway" ? "…" : "Send anyway"}
            </button>
          ) : item.status !== "failed" ? (
            <>
              <button
                disabled={!!busy}
                onClick={() => act("approve-now")}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === "approve-now" ? "…" : "Approve now"}
              </button>
              <button
                disabled={!!busy}
                onClick={() => act("approve-suggested")}
                className="rounded-md border border-sky-400/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
              >
                {busy === "approve-suggested"
                  ? "…"
                  : item.suggested_at
                    ? `Approve for ${when(item.suggested_at)}`
                    : "Approve at suggested time"}
              </button>
            </>
          ) : null}
          {dirty || item.status === "failed" || item.status === "held" ? (
            <button
              disabled={!!busy || !dirty}
              onClick={() => act("save")}
              className="rounded-md border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"
            >
              {busy === "save"
                ? "…"
                : item.status === "failed" || item.status === "held"
                  ? "Save edit → back to pending"
                  : "Save edit"}
            </button>
          ) : null}
          <button
            disabled={!!busy}
            onClick={() => act("skip")}
            className="ml-auto rounded-md border border-rose-400/30 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
          >
            {busy === "skip" ? "…" : "Skip"}
          </button>
        </div>
      ) : null}
      {err ? <div className="mt-2 text-xs text-rose-300">{err}</div> : null}
    </Tag>
  );
}

// Newest pending draft per lead + how many older pending ones it hides. freesite allows one open draft per lead
// (lib/outbox addOutbox), so "older" only shows up on rows from before that rule.
function pendingPerLead(outbox: OutboxItem[]) {
  const newest = new Map<string, OutboxItem>();
  const older = new Map<string, number>();
  for (const o of outbox) {
    if (o.status !== "pending" || !o.lead_key) continue;
    const cur = newest.get(o.lead_key);
    if (cur) older.set(o.lead_key, (older.get(o.lead_key) || 0) + 1);
    if (!cur || o.id > cur.id) newest.set(o.lead_key, o);
  }
  return { newest, older };
}

export function OutboxPanel({
  outbox,
  leads,
  interactive,
}: {
  outbox: OutboxItem[];
  leads: NewlyUpLead[];
  interactive: boolean;
}) {
  const byKey = new Map(leads.map((l) => [l.key, l]));
  // One pending draft per lead on screen (Abraham #14/#16, 2026-11-18): the newest, with "+N older draft".
  const { newest, older } = pendingPerLead(outbox);
  const open = outbox
    .filter(
      (o) =>
        OPEN.includes(o.status) &&
        (o.status !== "pending" ||
          !o.lead_key ||
          newest.get(o.lead_key)?.id === o.id),
    )
    .sort(
      (a, b) =>
        (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
        a.id - b.id,
    );
  const done = outbox.filter((o) => !OPEN.includes(o.status));
  const [showDone, setShowDone] = useState(false);
  // Phase 2: each lead's draft is approved from its "Needs you" row, so the full queue starts folded unless a draft
  // has no lead row to sit under.
  const [expanded, setExpanded] = useState(() =>
    open.some((o) => !o.lead_key || !byKey.has(o.lead_key)),
  );
  return (
    <section className="min-w-0 rounded-xl border border-amber-400/20 bg-amber-500/[0.03] p-3 sm:p-4">
      <header
        className={`flex flex-wrap items-baseline justify-between gap-2 ${
          expanded ? "mb-3" : ""
        }`}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-left text-sm font-semibold uppercase tracking-wide text-white/80"
        >
          <span
            className={`mr-1 inline-block w-3 text-white/40 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            ›
          </span>
          Outbox{" "}
          <span className="text-amber-300">
            {open.filter((o) => o.status === "pending").length} waiting
          </span>
          <span className="ml-1 text-[11px] font-normal normal-case text-white/35">
            {expanded ? "" : "· all drafts in one list"}
          </span>
        </button>
        <span className="text-xs text-white/40">
          {interactive
            ? "approved drafts are sent by outbox-worker, one per minute"
            : "read-only copy — approve from the Mac dashboard"}
        </span>
      </header>
      {!expanded ? null : (
        <>
          {open.length === 0 ? (
            <p className="text-sm text-white/40">No drafts waiting.</p>
          ) : null}
          <ul className="space-y-3">
            {open.map((o) => (
              <DraftCard
                key={`${o.id}-${o.status}-${o.text.length}`}
                item={o}
                lead={o.lead_key ? byKey.get(o.lead_key) : undefined}
                interactive={interactive}
                older={
                  o.status === "pending" && o.lead_key
                    ? older.get(o.lead_key)
                    : 0
                }
              />
            ))}
          </ul>
          {done.length ? (
            <div className="mt-3">
              <button
                onClick={() => setShowDone((v) => !v)}
                className="text-xs text-white/50 underline decoration-white/20"
              >
                {showDone ? "Hide" : "Show"} last 7 days (
                {done.filter((d) => d.status === "sent").length} sent ·{" "}
                {done.filter((d) => d.status === "failed").length} failed ·{" "}
                {done.filter((d) => d.status === "skipped").length} skipped)
              </button>
              {showDone ? (
                <ul className="mt-2 space-y-3">
                  {done.map((o) => (
                    <DraftCard
                      key={`${o.id}-${o.status}`}
                      item={o}
                      lead={o.lead_key ? byKey.get(o.lead_key) : undefined}
                      interactive={interactive}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function LeadCard({ l, draft }: { l: NewlyUpLead; draft?: OutboxItem }) {
  return (
    <li className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-sm [overflow-wrap:anywhere]">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-white/90">
          {l.business}
        </span>
        {draft ? (
          <a
            href={`#outbox-${draft.id}`}
            className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200 ring-1 ring-amber-500/40"
          >
            draft waiting
          </a>
        ) : null}
      </div>
      {l.contact && l.contact !== l.business ? (
        <div className="text-xs text-white/50">{l.contact}</div>
      ) : null}
      <div className="text-[11px] text-white/35">
        {l.source}
        {l.city ? ` · ${l.city}` : ""}
      </div>
      {l.last_text ? (
        <div className="mt-1 line-clamp-3 text-xs text-white/60">
          {l.last_text}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[11px]">
        <span className="text-white/35">{when(l.last_at)}</span>
        {l.preview_url ? (
          <a
            className="text-sky-300 underline decoration-sky-300/30"
            href={l.preview_url}
            target="_blank"
            rel="noreferrer"
          >
            preview ↗
          </a>
        ) : null}
      </div>
      {l.next_action ? (
        <div className="mt-1 text-[11px] text-amber-200/70 sm:line-clamp-2">
          → {l.next_action}
        </div>
      ) : null}
    </li>
  );
}

function ago(iso?: string | null) {
  if (!iso) return "";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (!Number.isFinite(m)) return "";
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  if (m < 60 * 24 * 60) return `${Math.round(m / 1440)}d`;
  return `${Math.round(m / 43200)}mo`;
}

// Their last message is newer than ours (or we never answered).
const unanswered = (l: NewlyUpLead) =>
  !!l.last_in_at && (!l.last_out_at || l.last_in_at > l.last_out_at);
const byRecent = (a: NewlyUpLead, b: NewlyUpLead) =>
  (b.last_at || "").localeCompare(a.last_at || "");

function why(l: NewlyUpLead, draft?: OutboxItem) {
  if (draft) return "draft waiting";
  if (unanswered(l)) return "they replied";
  return "go-live step";
}

function Msg({ m, who, dim }: { m: LeadMsg; who: string; dim?: boolean }) {
  const verbatim = !!m.body;
  return (
    <div
      className={`rounded-md p-2 ${
        dim
          ? "bg-white/[0.03] text-white/55"
          : "bg-sky-500/[0.08] text-white/90 ring-1 ring-sky-400/20"
      }`}
    >
      <div className="mb-0.5 flex flex-wrap gap-x-1.5 text-[10px] uppercase text-white/40">
        <span className={dim ? "" : "font-semibold text-sky-200/80"}>
          {who}
        </span>
        <span suppressHydrationWarning>· {when(m.at)}</span>
        <span>· {m.kind}</span>
        {verbatim ? null : (
          <span className="normal-case text-amber-200/60">
            · our log note (exact words not stored)
          </span>
        )}
      </div>
      <div
        className={`whitespace-pre-wrap ${
          dim ? "line-clamp-3" : "text-[13px] leading-snug"
        }`}
      >
        {m.body || m.text}
      </div>
    </div>
  );
}

const tomorrow = () => {
  const d = new Date(Date.now() + 86400e3);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
};

// The expanded "Needs you" row (phase 2): their words, our suggested reply + approve, "tell me what to do" redraft,
// snooze / lost / open chat / go live. Every write is a local-only API route (lib/local-gate).
function LeadDetail({
  l,
  draft,
  older,
  held,
  interactive,
  autoJob,
}: {
  l: NewlyUpLead;
  draft?: OutboxItem;
  /** Older pending drafts hidden behind `draft`. */
  older?: number;
  /** A send outbox-worker held: a similar message reached them in the last 12h ("Send anyway"). */
  held?: OutboxItem;
  interactive: boolean;
  /** Set while the page-load autodraft for this row is running (lib/autodraft in freesite). */
  autoJob?: string;
}) {
  const router = useRouter();
  const [ins, setIns] = useState("");
  const [job, setJob] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [until, setUntil] = useState(tomorrow);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  async function post(payload: Record<string, unknown>) {
    const r = await fetch("/api/newlyup/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: l.key, ...payload }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      error?: string;
      job?: string;
    };
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  async function act(name: string, payload: Record<string, unknown>) {
    setBusy(name);
    setErr(null);
    try {
      await post(payload);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function redraft(useDefault = false) {
    setErr(null);
    try {
      const { job: id } = await post(
        useDefault
          ? { action: "redraft", default: true }
          : { action: "redraft", instruction: ins },
      );
      if (!id) throw new Error("no job id");
      setJob(id);
      poll.current = setInterval(async () => {
        const r = await fetch(
          `/api/newlyup/lead?job=${encodeURIComponent(id)}`,
        ).catch(() => null);
        const j = r
          ? ((await r.json().catch(() => ({}))) as {
              status?: string;
              error?: string;
            })
          : {};
        if (
          j.status === "done" ||
          j.status === "failed" ||
          j.status === "superseded"
        ) {
          if (poll.current) clearInterval(poll.current);
          setJob(null);
          if (j.status === "failed")
            setErr(`redraft failed: ${j.error || "unknown"}`);
          // freesite nu-redraft drops a draft when a reply was sent/approved while it was being written.
          else if (j.status === "superseded")
            setErr(`draft dropped: ${j.error || "a reply already went out"}`);
          else if (!useDefault) setIns("");
          router.refresh();
        }
      }, 3000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const won = l.card_saved || boardColumn(l) === "Card saved / won";
  const btn = "rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-40";
  return (
    <div className="space-y-2 px-3 pb-3 text-xs [overflow-wrap:anywhere] sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
      <div className="min-w-0 space-y-2">
        {l.last_in ? (
          <Msg
            m={l.last_in}
            who={`${(l.contact || l.business).split(" ")[0]} wrote`}
          />
        ) : (
          <div className="rounded-md bg-white/[0.03] p-2 text-white/40">
            No message from them on file yet.
          </div>
        )}
        {l.last_out ? <Msg m={l.last_out} who="we sent" dim /> : null}
        {l.next_action ? (
          <div className="text-amber-200/80">
            → {l.next_action}
            {l.next_action_at ? (
              <span suppressHydrationWarning className="ml-1 text-white/40">
                ({when(l.next_action_at)})
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="text-[11px] text-white/35">
          {l.stage} · {l.source}
          {l.group ? ` · ${l.group}` : ""}
        </div>
      </div>
      <div className="min-w-0 space-y-2">
        {held ? (
          <DraftCard
            key={`held-${held.id}-${held.text.length}`}
            item={held}
            lead={l}
            interactive={interactive}
            compact
          />
        ) : null}
        {held && !draft ? null : draft ? (
          <DraftCard
            key={`${draft.id}-${draft.text.length}`}
            item={draft}
            lead={l}
            interactive={interactive}
            compact
            older={older}
          />
        ) : autoJob || job ? (
          <div className="animate-pulse rounded-md border border-dashed border-sky-400/30 p-2 text-sky-200/80">
            drafting… an agent is writing the next reply (≈1 min). It lands here
            as pending; nothing is sent.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-white/15 p-2 text-white/40">
            <span className="flex-1">No draft waiting for this lead.</span>
            {interactive ? (
              <button
                onClick={() => redraft(true)}
                className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-500"
              >
                Draft now
              </button>
            ) : null}
          </div>
        )}
        {interactive ? (
          <div className="space-y-1.5">
            <label
              htmlFor={`ins-${l.key}`}
              className="text-[10px] font-semibold uppercase text-white/50"
            >
              Tell me what to do
            </label>
            <textarea
              id={`ins-${l.key}`}
              value={ins}
              onChange={(e) => setIns(e.target.value)}
              disabled={!!job}
              rows={2}
              placeholder={`e.g. "say the review button is added, send the Keep link"`}
              className="w-full rounded-md border border-white/15 bg-white/[0.03] p-2 text-[13px] text-white/90 placeholder:text-white/25 focus:border-sky-400/60 focus:outline-none"
            />
            <button
              disabled={!!job || !!autoJob || !ins.trim()}
              onClick={() => redraft()}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {job ? "drafting…" : "Redraft"}
            </button>
            {job ? (
              <span className="ml-2 animate-pulse text-[11px] text-sky-200/70">
                an agent is writing a new draft (≈1 min); it lands above as
                pending
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {interactive ? (
            snoozeOpen ? (
              <span className="flex items-center gap-1">
                <input
                  type="date"
                  value={until}
                  min={tomorrow()}
                  onChange={(e) => setUntil(e.target.value)}
                  className="rounded-md border border-white/20 bg-black/30 px-1.5 py-1 text-xs text-white/80"
                />
                <button
                  disabled={!!busy}
                  onClick={() =>
                    act("snooze", {
                      action: "snooze",
                      until: `${until}T09:00:00-08:00`,
                    })
                  }
                  className={`${btn} border-sky-400/40 text-sky-200`}
                >
                  {busy === "snooze" ? "…" : "Snooze"}
                </button>
                <button
                  onClick={() => setSnoozeOpen(false)}
                  className="px-1 text-white/40"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                onClick={() => setSnoozeOpen(true)}
                className={`${btn} border-white/20 text-white/75`}
              >
                Snooze…
              </button>
            )
          ) : null}
          {interactive ? (
            <button
              disabled={!!busy}
              onClick={() => {
                const reason = prompt(`Mark ${l.business} lost. Reason?`);
                if (reason && reason.trim())
                  act("lost", { action: "lost", reason });
              }}
              className={`${btn} border-rose-400/30 text-rose-200`}
            >
              {busy === "lost" ? "…" : "Mark lost"}
            </button>
          ) : null}
          {l.thread_url ? (
            <a
              href={draft?.thread_url || l.thread_url}
              target="_blank"
              rel="noreferrer"
              className={`${btn} border-white/20 text-sky-200`}
            >
              Open chat ↗
            </a>
          ) : null}
          {l.preview_url ? (
            <a
              href={l.preview_url}
              target="_blank"
              rel="noreferrer"
              className={`${btn} border-white/20 text-sky-200`}
            >
              Preview ↗
            </a>
          ) : null}
          {won ? (
            <span className="flex items-center gap-1.5">
              <button
                disabled
                title="Not wired yet"
                className={`${btn} border-emerald-400/30 text-emerald-200`}
              >
                Go live
              </button>
              <span className="text-[10px] text-white/35">
                coming soon: ask in Telegram to run go-live
              </span>
            </span>
          ) : null}
        </div>
        {err ? <div className="text-xs text-rose-300">{err}</div> : null}
      </div>
    </div>
  );
}

function LeadRow({
  l,
  draft,
  older,
  held,
  open,
  onToggle,
  reason,
  interactive,
  autoJob,
  until,
}: {
  l: NewlyUpLead;
  draft?: OutboxItem;
  older?: number;
  held?: OutboxItem;
  open: boolean;
  onToggle: () => void;
  reason?: string;
  interactive: boolean;
  autoJob?: string;
  /** Waiting rows: the date we wait until (next_action_at). */
  until?: string | null;
}) {
  const card = l.card_saved || boardColumn(l) === "Card saved / won";
  const sub = [
    until ? `wait until ${day(until)}` : null,
    [l.contact && l.contact !== l.business ? l.contact : null, l.city]
      .filter(Boolean)
      .join(" · ") ||
      reason ||
      l.source,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      id={`lead-${l.key}`}
      className={`min-w-0 scroll-mt-4 ${open ? "bg-white/[0.04]" : ""}`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left active:bg-white/5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white/90">
            {l.business}
          </span>
          <span className="block truncate text-[11px] text-white/40">
            {sub}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {unanswered(l) ? (
            <span
              title="replied since our last message"
              className="h-2 w-2 rounded-full bg-sky-400"
            />
          ) : null}
          {held ? (
            <span className="rounded bg-orange-500/20 px-1 py-px text-[10px] font-semibold uppercase text-orange-200 ring-1 ring-orange-500/40">
              held
            </span>
          ) : draft ? (
            <span className="rounded bg-amber-500/20 px-1 py-px text-[10px] font-semibold uppercase text-amber-200 ring-1 ring-amber-500/40">
              draft
            </span>
          ) : autoJob ? (
            <span className="animate-pulse rounded bg-sky-500/15 px-1 py-px text-[10px] font-semibold text-sky-200 ring-1 ring-sky-500/30">
              drafting…
            </span>
          ) : null}
          {card ? (
            <span className="rounded bg-emerald-500/20 px-1 py-px text-[10px] font-semibold uppercase text-emerald-200 ring-1 ring-emerald-500/40">
              card
            </span>
          ) : null}
          <span
            suppressHydrationWarning
            className="w-7 text-right text-[11px] tabular-nums text-white/40"
          >
            {ago(l.last_at)}
          </span>
        </span>
      </button>
      {open ? (
        <LeadDetail
          l={l}
          draft={draft}
          older={older}
          held={held}
          interactive={interactive}
          autoJob={autoJob}
        />
      ) : null}
    </li>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  accent,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        accent
          ? "border-amber-400/25 bg-amber-500/[0.04]"
          : "border-white/10 bg-black/10"
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span
          className={`inline-block w-3 text-white/40 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm font-semibold ${
            accent ? "text-amber-200" : "text-white/75"
          }`}
        >
          {title}{" "}
          <span className="font-normal tabular-nums text-white/40">
            · {count}
          </span>
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

function StageList({
  list,
  drafts,
}: {
  list: NewlyUpLead[];
  drafts: Map<string, OutboxItem>;
}) {
  return (
    <ul className="space-y-2">
      {list.length === 0 ? (
        <li className="text-[11px] text-white/25">—</li>
      ) : null}
      {list.map((l) => (
        <LeadCard key={l.key} l={l} draft={drafts.get(l.key)} />
      ))}
    </ul>
  );
}

export function LeadBoard({
  leads,
  outbox,
  interactive = false,
}: {
  leads: NewlyUpLead[];
  outbox: OutboxItem[];
  interactive?: boolean;
}) {
  const [showLost, setShowLost] = useState(false);
  // Phones: one expanded row and any number of open sections; "Needs you" starts open, stages start closed.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [openSecs, setOpenSecs] = useState<Set<string>>(
    () => new Set(["needs"]),
  );
  const toggleSec = (k: string) =>
    setOpenSecs((s) =>
      s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k]),
    );
  // One pending draft per lead: the newest, with a "+N older draft" note when legacy rows hide behind it.
  const { newest: drafts, older } = pendingPerLead(outbox);
  // Sends outbox-worker held (similar message sent to the lead in the last 12h): shown on the row with Send anyway.
  const held = new Map<string, OutboxItem>();
  for (const o of outbox)
    if (o.status === "held" && o.lead_key && !held.has(o.lead_key))
      held.set(o.lead_key, o);
  // Leads with a reply already approved/scheduled/sending/held: never autodrafted (Abraham #11/#12 race, 2026-11-18).
  const inFlight = new Set(
    outbox
      .filter((o) =>
        ["approved", "scheduled", "sending", "held"].includes(o.status),
      )
      .map((o) => o.lead_key),
  );
  const cols = new Map<Column, NewlyUpLead[]>();
  for (const l of leads) {
    const c = boardColumn(l);
    cols.set(c, [...(cols.get(c) || []), l]);
  }
  const lost = cols.get("Lost / Later") || [];
  const all = [...COLUMNS, "Lost / Later" as const];
  // Rule (2026-11-18): every "Needs you" row has a draft, or is drafting one, or is not in "Needs you". A deliberate
  // wait (future next_action_at set after their last message, incl. snoozes; lib/newlyup `waiting`) moves the row to
  // the collapsed "Waiting" group until the date or their next message. Card-saved/won rows never wait: the go-live
  // step is Shib's. Rows left without a draft get one on page load (autodraft below).
  // A lead whose last event is our sent message is not in "Needs you" (2026-11-18, Abraham after #11 went out):
  // a draft made before that send is stale (freesite supersedes it on send), and a card-saved/won lead waits in
  // "Waiting" until its next action date. A draft made after our send (a nudge from the digest) still counts.
  const ourMove = (l: NewlyUpLead) =>
    !!l.last_out_at && (!l.last_at || l.last_out_at >= l.last_at);
  const liveDraft = (l: NewlyUpLead) => {
    const d = drafts.get(l.key);
    return !!d && !(ourMove(l) && d.created_at < (l.last_out_at || ""));
  };
  const wanted = (l: NewlyUpLead) =>
    held.has(l.key) ||
    liveDraft(l) ||
    (boardColumn(l) !== "Lost / Later" && unanswered(l)) ||
    (boardColumn(l) === "Card saved / won" &&
      (!ourMove(l) || !!l.next_action_at));
  const waits = (l: NewlyUpLead) =>
    !held.has(l.key) &&
    (!!l.snoozed ||
      (!!l.waiting && boardColumn(l) !== "Card saved / won" && !l.card_saved) ||
      (ourMove(l) && !liveDraft(l)));
  const needs = leads.filter((l) => wanted(l) && !waits(l)).sort(byRecent);
  const waiting = leads
    .filter((l) => wanted(l) && waits(l))
    .sort((a, b) =>
      (a.next_action_at || "").localeCompare(b.next_action_at || ""),
    );
  // Autodraft: Needs-you rows with no pending draft ask freesite for one (deduped there per lead per inbound message),
  // then poll the jobs and refresh when each lands. Local + interactive only; the Vercel copy is read-only.
  const router = useRouter();
  const [autoJobs, setAutoJobs] = useState<Record<string, string>>({});
  const bare = needs
    .filter((l) => !drafts.has(l.key) && !inFlight.has(l.key))
    .map((l) => l.key)
    .join(",");
  useEffect(() => {
    if (!interactive || !bare) return;
    let gone = false;
    fetch("/api/newlyup/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "autodraft", keys: bare.split(",") }),
    })
      .then((r) => r.json())
      .then(
        (j: { results?: { lead: string; status: string; job?: string }[] }) => {
          if (gone) return;
          const running: Record<string, string> = {};
          for (const r of j.results || [])
            if ((r.status === "started" || r.status === "drafting") && r.job)
              running[r.lead] = r.job;
          setAutoJobs((cur) => ({ ...cur, ...running }));
        },
      )
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [interactive, bare]);
  const jobList = Object.entries(autoJobs);
  useEffect(() => {
    if (!jobList.length) return;
    const t = setInterval(async () => {
      for (const [lead, job] of jobList) {
        const r = await fetch(
          `/api/newlyup/lead?job=${encodeURIComponent(job)}`,
        ).catch(() => null);
        const j = r
          ? ((await r.json().catch(() => ({}))) as { status?: string })
          : {};
        if (j.status && j.status !== "drafting") {
          setAutoJobs((cur) => {
            const next = { ...cur };
            delete next[lead];
            return next;
          });
          router.refresh();
        }
      }
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobList.map(([k, v]) => k + v).join(",")]);
  // Telegram alerts link /newlyup?lead=<key>: open that row (in Needs you when it is there) and scroll to it.
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("lead");
    if (!key) return;
    const inNeeds = needs.some((l) => l.key === key);
    const inWaiting = waiting.some((l) => l.key === key);
    const lead = leads.find((l) => l.key === key);
    if (!lead) return;
    const sec = inNeeds ? "needs" : inWaiting ? "waiting" : boardColumn(lead);
    setOpenSecs((s) => new Set([...s, sec]));
    setOpenRow(`${sec}:${key}`);
    setTimeout(
      () =>
        document
          .getElementById(`lead-${key}`)
          ?.scrollIntoView({ block: "start" }),
      50,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rows = (
    prefix: string,
    list: NewlyUpLead[],
    reason?: (l: NewlyUpLead) => string,
  ) => (
    <ul className="divide-y divide-white/5 border-t border-white/5">
      {list.map((l) => {
        const k = `${prefix}:${l.key}`;
        return (
          <LeadRow
            key={k}
            l={l}
            draft={drafts.get(l.key)}
            older={older.get(l.key)}
            held={held.get(l.key)}
            open={openRow === k}
            onToggle={() => setOpenRow((r) => (r === k ? null : k))}
            reason={reason?.(l)}
            interactive={interactive}
            autoJob={autoJobs[l.key]}
            until={prefix === "waiting" ? l.next_action_at : undefined}
          />
        );
      })}
    </ul>
  );
  return (
    <section className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/80">
          Lead board
        </h2>
        <span className="text-xs text-white/40">
          {leads.length - lost.length} open · {drafts.size} with a draft waiting
          <span className="max-sm:hidden"> · scroll →</span>
        </span>
      </header>

      <div className="mb-2 sm:mb-4">
        <Section
          title="Needs you"
          count={needs.length}
          accent
          open={openSecs.has("needs")}
          onToggle={() => toggleSec("needs")}
        >
          {needs.length ? (
            rows("needs", needs, (l) => why(l, drafts.get(l.key)))
          ) : (
            <p className="border-t border-white/5 px-3 py-2.5 text-xs text-white/40">
              Nothing needs you right now
            </p>
          )}
        </Section>
        {waiting.length ? (
          <div className="mt-2">
            <Section
              title="Waiting"
              count={waiting.length}
              open={openSecs.has("waiting")}
              onToggle={() => toggleSec("waiting")}
            >
              {rows("waiting", waiting)}
            </Section>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 sm:hidden">
        {all.map((c) => {
          const list = [...(cols.get(c) || [])].sort(byRecent);
          if (!list.length) return null;
          return (
            <Section
              key={c}
              title={c}
              count={list.length}
              open={openSecs.has(c)}
              onToggle={() => toggleSec(c)}
            >
              {rows(c, list)}
            </Section>
          );
        })}
      </div>

      <div className="-mx-4 hidden snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:flex">
        {all.map((c) => {
          const list = cols.get(c) || [];
          const collapsed = c === "Lost / Later" && !showLost;
          return (
            <div
              key={c}
              className={`flex shrink-0 snap-start flex-col ${
                collapsed ? "w-28" : "w-60"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">{c}</span>
                {c === "Lost / Later" ? (
                  <button
                    onClick={() => setShowLost((v) => !v)}
                    className="text-[11px] text-white/40 underline decoration-white/20"
                  >
                    {list.length} · {showLost ? "hide" : "show"}
                  </button>
                ) : (
                  <span className="text-[11px] tabular-nums text-white/30">
                    {list.length}
                  </span>
                )}
              </div>
              {collapsed ? null : <StageList list={list} drafts={drafts} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
