"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NewlyUpLead, OutboxItem } from "@/lib/newlyup";

// Lead board + approval queue for /newlyup (Shib "go dashboard", 2026-11-18). Drafts live in freesite.db `outbox`;
// the buttons POST to /api/newlyup/outbox, which only works on the Mac (lib/local-gate). On the Vercel copy
// (`interactive` false) everything renders read-only.

const COLUMNS = ["New", "Replied", "Preview built", "Preview sent", "Price quoted", "Card saved / won", "Live"] as const;
type Column = (typeof COLUMNS)[number] | "Lost / Later";

export function boardColumn(l: NewlyUpLead): Column {
  if (l.live) return "Live";
  if (l.stage === "won" || /^card saved/i.test(l.next_action || "")) return "Card saved / won";
  return (
    ({ new: "New", replied: "Replied", engaged: "Replied", "preview-built": "Preview built", "preview-sent": "Preview sent", "price-quoted": "Price quoted" } as Record<string, Column>)[l.stage] ??
    "Lost / Later"
  );
}

const OPEN = ["pending", "approved", "scheduled", "sending"];
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  scheduled: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  sending: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  sent: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  skipped: "bg-white/10 text-white/40 ring-white/15",
};

function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Pill({ label, style }: { label: string; style?: string }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${style || "bg-white/10 text-white/60 ring-white/15"}`}>{label}</span>;
}

function DraftCard({ item, lead, interactive }: { item: OutboxItem; lead?: NewlyUpLead; interactive: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editable = interactive && ["pending", "approved", "scheduled", "failed"].includes(item.status);
  const dirty = text !== item.text;

  async function act(action: "approve-now" | "approve-suggested" | "skip" | "save") {
    if (action === "approve-now" && !confirm(`Send this to ${lead?.business || item.lead_key || "this lead"} now?`)) return;
    setBusy(action);
    setErr(null);
    try {
      const r = await fetch("/api/newlyup/outbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action, text }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li id={`outbox-${item.id}`} className="scroll-mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill label={item.status} style={STATUS_STYLE[item.status]} />
        <span className="font-medium text-white/90">{lead?.business || item.lead_key || "(no lead)"}</span>
        {lead?.contact && lead.contact !== lead.business ? <span className="text-xs text-white/40">{lead.contact}</span> : null}
        <span className="text-[11px] text-white/40">
          #{item.id} · {item.channel}
          {item.created_by ? ` · by ${item.created_by}` : ""}
        </span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!editable}
          rows={Math.min(12, Math.max(4, text.split("\n").length + 1))}
          className="min-h-24 w-full flex-1 rounded-md border border-white/15 bg-white/[0.03] p-2 text-sm leading-relaxed text-white/90 focus:border-sky-400/60 focus:outline-none"
        />
        {item.image_path ? (
          interactive ? (
            <a href={`/api/newlyup/outbox/image?path=${encodeURIComponent(item.image_path)}`} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/newlyup/outbox/image?path=${encodeURIComponent(item.image_path)}`} alt="attachment" className="h-28 w-28 rounded-md border border-white/10 object-cover sm:h-32 sm:w-32" />
            </a>
          ) : (
            <div className="shrink-0 text-[11px] break-all text-white/40 sm:w-32">image: {item.image_path}</div>
          )
        ) : null}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-white/45">
        <div>
          thread:{" "}
          {item.thread_url ? (
            <a className="break-all text-sky-300 underline decoration-sky-300/30" href={item.thread_url} target="_blank" rel="noreferrer">
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
          {item.status !== "failed" ? (
            <>
              <button disabled={!!busy} onClick={() => act("approve-now")} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy === "approve-now" ? "…" : "Approve now"}
              </button>
              <button disabled={!!busy} onClick={() => act("approve-suggested")} className="rounded-md border border-sky-400/40 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10 disabled:opacity-50">
                {busy === "approve-suggested" ? "…" : item.suggested_at ? `Approve for ${when(item.suggested_at)}` : "Approve at suggested time"}
              </button>
            </>
          ) : null}
          {dirty || item.status === "failed" ? (
            <button disabled={!!busy || !dirty} onClick={() => act("save")} className="rounded-md border border-white/20 px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40">
              {busy === "save" ? "…" : item.status === "failed" ? "Save edit → back to pending" : "Save edit"}
            </button>
          ) : null}
          <button disabled={!!busy} onClick={() => act("skip")} className="ml-auto rounded-md border border-rose-400/30 px-3 py-2 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-50">
            {busy === "skip" ? "…" : "Skip"}
          </button>
        </div>
      ) : null}
      {err ? <div className="mt-2 text-xs text-rose-300">{err}</div> : null}
    </li>
  );
}

export function OutboxPanel({ outbox, leads, interactive }: { outbox: OutboxItem[]; leads: NewlyUpLead[]; interactive: boolean }) {
  const byKey = new Map(leads.map((l) => [l.key, l]));
  const open = outbox.filter((o) => OPEN.includes(o.status)).sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || a.id - b.id);
  const done = outbox.filter((o) => !OPEN.includes(o.status));
  const [showDone, setShowDone] = useState(false);
  return (
    <section className="rounded-xl border border-amber-400/20 bg-amber-500/[0.03] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">
          Outbox <span className="text-amber-300">{open.filter((o) => o.status === "pending").length} waiting</span>
        </h2>
        <span className="text-xs text-white/40">{interactive ? "approved drafts are sent by outbox-worker, one per minute" : "read-only copy — approve from the Mac dashboard"}</span>
      </header>
      {open.length === 0 ? <p className="text-sm text-white/40">No drafts waiting.</p> : null}
      <ul className="space-y-3">
        {open.map((o) => (
          <DraftCard key={`${o.id}-${o.status}-${o.text.length}`} item={o} lead={o.lead_key ? byKey.get(o.lead_key) : undefined} interactive={interactive} />
        ))}
      </ul>
      {done.length ? (
        <div className="mt-3">
          <button onClick={() => setShowDone((v) => !v)} className="text-xs text-white/50 underline decoration-white/20">
            {showDone ? "Hide" : "Show"} last 7 days ({done.filter((d) => d.status === "sent").length} sent · {done.filter((d) => d.status === "failed").length} failed · {done.filter((d) => d.status === "skipped").length} skipped)
          </button>
          {showDone ? (
            <ul className="mt-2 space-y-3">
              {done.map((o) => (
                <DraftCard key={`${o.id}-${o.status}`} item={o} lead={o.lead_key ? byKey.get(o.lead_key) : undefined} interactive={interactive} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LeadCard({ l, draft }: { l: NewlyUpLead; draft?: OutboxItem }) {
  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium break-words text-white/90">{l.business}</span>
        {draft ? (
          <a href={`#outbox-${draft.id}`} className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200 uppercase ring-1 ring-amber-500/40">
            draft waiting
          </a>
        ) : null}
      </div>
      {l.contact && l.contact !== l.business ? <div className="text-xs text-white/50">{l.contact}</div> : null}
      <div className="text-[11px] text-white/35">
        {l.source}
        {l.city ? ` · ${l.city}` : ""}
      </div>
      {l.last_text ? <div className="mt-1 line-clamp-3 text-xs text-white/60">{l.last_text}</div> : null}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[11px]">
        <span className="text-white/35">{when(l.last_at)}</span>
        {l.preview_url ? (
          <a className="text-sky-300 underline decoration-sky-300/30" href={l.preview_url} target="_blank" rel="noreferrer">
            preview ↗
          </a>
        ) : null}
      </div>
      {l.next_action ? <div className="mt-1 line-clamp-2 text-[11px] text-amber-200/70">→ {l.next_action}</div> : null}
    </li>
  );
}

export function LeadBoard({ leads, outbox }: { leads: NewlyUpLead[]; outbox: OutboxItem[] }) {
  const [showLost, setShowLost] = useState(false);
  const drafts = new Map<string, OutboxItem>();
  for (const o of outbox) if (o.status === "pending" && o.lead_key && !drafts.has(o.lead_key)) drafts.set(o.lead_key, o);
  const cols = new Map<Column, NewlyUpLead[]>();
  for (const l of leads) {
    const c = boardColumn(l);
    cols.set(c, [...(cols.get(c) || []), l]);
  }
  const lost = cols.get("Lost / Later") || [];
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">Lead board</h2>
        <span className="text-xs text-white/40">
          {leads.length - lost.length} open · {drafts.size} with a draft waiting · swipe →
        </span>
      </header>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
        {[...COLUMNS, "Lost / Later" as const].map((c) => {
          const list = cols.get(c) || [];
          const collapsed = c === "Lost / Later" && !showLost;
          return (
            <div key={c} className={`flex shrink-0 snap-start flex-col ${collapsed ? "w-28" : "w-[78vw] sm:w-60"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/70">{c}</span>
                {c === "Lost / Later" ? (
                  <button onClick={() => setShowLost((v) => !v)} className="text-[11px] text-white/40 underline decoration-white/20">
                    {list.length} · {showLost ? "hide" : "show"}
                  </button>
                ) : (
                  <span className="text-[11px] text-white/30 tabular-nums">{list.length}</span>
                )}
              </div>
              {collapsed ? null : (
                <ul className="space-y-2">
                  {list.length === 0 ? <li className="text-[11px] text-white/25">—</li> : null}
                  {list.map((l) => (
                    <LeadCard key={l.key} l={l} draft={drafts.get(l.key)} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
