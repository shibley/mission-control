"use client";

import Link from "next/link";
import type { DashboardData } from "@/lib/source";

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  doing: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  open: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  blocked: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  parked: "bg-white/10 text-white/40 ring-white/15",
};

const FB_STYLE: Record<string, string> = {
  join: "bg-white/10 text-white/60 ring-white/15",
  post: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  comment: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  dm: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  reply: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  lead: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

const STAGES = ["new", "replied", "preview-built", "preview-sent", "engaged", "price-quoted", "won", "later", "lost"];
const STAGE_STYLE: Record<string, string> = {
  new: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  replied: "bg-white/10 text-white/60 ring-white/15",
  "preview-built": "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  "preview-sent": "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  engaged: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  "price-quoted": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  won: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  later: "bg-white/10 text-white/40 ring-white/15",
  lost: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

function day(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" });
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-wide text-white/80 uppercase">{title}</h2>
        {right ? <div className="text-xs text-white/40">{right}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Badge({ label, style }: { label: string; style?: string }) {
  return (
    <span className={`shrink-0 self-start rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${style || "bg-white/10 text-white/60 ring-white/15"}`}>
      {label}
    </span>
  );
}

function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function NewlyUp({ initial }: { initial: DashboardData }) {
  const t = (initial.snapshot as { newlyupTab?: import("@/lib/newlyup").NewlyUpTab } | null)?.newlyupTab;
  if (!t) return <main className="p-6 text-white/60">No Newly Up data in this snapshot yet.</main>;
  const counts = t.tasks.reduce<Record<string, number>>((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {});
  // Older snapshots predate the lead/group tables.
  const leadList = t.leads ?? [];
  // Distinct people, not log lines: the fb log also records our own DMs and repeat comments (it read 17 for 3 leads).
  const leads = leadList.length || new Set(t.fb.filter((e) => e.kind === "lead").map((e) => (e as { who?: string }).who)).size;
  const groupList = t.groups ?? [];
  const byStage = leadList.reduce<Record<string, typeof leadList>>((a, l) => ((a[l.stage] ||= []).push(l), a), {});

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 text-white sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Newly Up</h1>
          <p className="text-sm text-white/50">Free AI-built site for any local business → $99–$297/mo. Goal: 100 sites, upside 1,000.</p>
        </div>
        <Link href="/" className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
          ← Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Card title="Tasks">
          <div className="text-3xl font-semibold tabular-nums">{counts.done || 0}/{t.tasks.length}</div>
          <div className="text-xs text-white/40">done · {counts.doing || 0} in progress</div>
        </Card>
        <Card title="Prospects">
          <div className="text-3xl font-semibold tabular-nums">{(t.pipeline?.lanes.weaksite || 0) + (t.pipeline?.lanes.nosite || 0)}</div>
          <div className="text-xs text-white/40">qualified of {t.pipeline?.total ?? 0} found · {t.pipeline?.withEmail ?? 0} emailable</div>
        </Card>
        <Card title="Facebook">
          <div className="text-3xl font-semibold tabular-nums">{t.fb.filter((e) => e.kind === "post").length}</div>
          <div className="text-xs text-white/40">posts · {leads} leads</div>
        </Card>
        <Card title="Previews">
          <div className="text-3xl font-semibold tabular-nums">{t.previews.filter((p) => p.lane === "fb-lead").length}</div>
          <div className="text-xs text-white/40">for leads · {t.previews.filter((p) => p.lane !== "fb-lead").length} older cold-email samples</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Lead pipeline" right={`${leadList.length} leads · ${t.leadsSource === "jsonl" ? "fb-log.jsonl (DB unreadable)" : "freesite.db leads"}`}>
          {leadList.length === 0 ? (
            <p className="text-sm text-white/40">No leads yet.</p>
          ) : (
            <div className="space-y-3">
              {[...STAGES, ...Object.keys(byStage).filter((s) => !STAGES.includes(s))]
                .filter((s) => byStage[s]?.length)
                .map((s) => (
                  <div key={s}>
                    <div className="mb-1 flex items-center gap-2">
                      <Badge label={s} style={STAGE_STYLE[s]} />
                      <span className="text-[11px] text-white/30">{byStage[s].length}</span>
                    </div>
                    <ul className="space-y-2 border-l border-white/10 pl-3">
                      {byStage[s].map((l) => (
                        <li key={l.key} className="text-sm">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-white/90">{l.business}</span>
                            {l.contact && l.contact !== l.business ? <span className="text-xs text-white/40">{l.contact}</span> : null}
                            {l.preview_url ? (
                              <a className="text-xs text-sky-300 underline decoration-sky-300/30 hover:decoration-sky-300" href={l.preview_url} target="_blank" rel="noreferrer">
                                preview ↗
                              </a>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-white/40">
                            {l.source}
                            {l.city ? ` · ${l.city}` : ""}
                            {l.group ? ` · ${l.group}` : ""}
                          </div>
                          {l.next_action ? (
                            <div className="mt-0.5 text-xs text-amber-200/80">
                              → {l.next_action}
                              {l.next_action_at ? <span className="ml-1 text-white/40">({when(l.next_action_at)})</span> : null}
                            </div>
                          ) : null}
                          {l.last_at ? <div className="text-[11px] text-white/30">last: {when(l.last_at)}</div> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card title="Facebook groups" right={`${groupList.filter((g) => g.joined).length} joined · ${groupList.length} tracked`}>
          {groupList.length === 0 ? (
            <p className="text-sm text-white/40">No groups yet.</p>
          ) : (
            <ul className="space-y-2">
              {groupList.map((g) => (
                <li key={g.url} className="flex gap-2 text-sm">
                  <div className="flex shrink-0 flex-col items-start gap-1">
                    <Badge label={g.joined ? "joined" : "not joined"} style={g.joined ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : undefined} />
                    {g.joined ? (
                      /declined/i.test(g.note || "") ? (
                        <Badge label="post declined" style="bg-red-500/15 text-red-300 ring-red-500/30" />
                      ) : g.posted_at ? (
                        <Badge label={`posted ${day(g.posted_at)}`} style="bg-sky-500/15 text-sky-300 ring-sky-500/30" />
                      ) : (
                        <Badge label="not posted" />
                      )
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <a className="min-w-0 underline decoration-white/20 hover:decoration-white" href={g.url} target="_blank" rel="noreferrer">
                        {g.name}
                      </a>
                      {g.leads ? <span className="shrink-0 text-xs font-semibold text-emerald-300">{g.leads} lead{g.leads === 1 ? "" : "s"}</span> : null}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {g.city || "?"}
                      {g.members != null ? ` · ${g.members.toLocaleString("en-US")} members` : ""}
                      {` · joined ${day(g.joined_at)} · posted ${day(g.posted_at)}`}
                    </div>
                    {g.note ? <div className="truncate text-[11px] text-white/30">{g.note}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Facebook activity" right="memory/newlyup/fb-log.jsonl">
          {t.fb.length === 0 ? (
            <p className="text-sm text-white/40">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {t.fb.map((e, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <Badge label={e.kind} style={FB_STYLE[e.kind]} />
                  <div className="min-w-0">
                    <div className="text-white/85">
                      {e.post_url || e.group_url ? (
                        <a className="underline decoration-white/20 hover:decoration-white" href={e.post_url || e.group_url} target="_blank" rel="noreferrer">
                          {e.group || e.who || "link"}
                        </a>
                      ) : (
                        e.group || e.who
                      )}
                      {e.status ? <span className="ml-2 text-xs text-white/40">{e.status}</span> : null}
                    </div>
                    {e.note ? <div className="text-xs text-white/50">{e.note}</div> : null}
                    <div className="text-[11px] text-white/30">{when(e.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tasks" right="priorities.json newlyup-*">
          <ul className="space-y-1.5">
            {t.tasks.filter((x) => x.id !== "freesite").map((x) => (
              <li key={x.id} className="flex items-start gap-2 text-sm">
                <Badge label={x.status} style={STATUS_STYLE[x.status]} />
                <span className={`min-w-0 ${x.status === "done" ? "text-white/40 line-through" : "text-white/85"}`}>{x.title}</span>
                {x.owner === "shib" ? <span className="ml-auto shrink-0 text-[10px] text-amber-300">YOU</span> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Pipeline by lane">
          {t.pipeline ? (
            <ul className="space-y-1 text-sm">
              {Object.entries(t.pipeline.lanes).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-white/70">{k}</span>
                  <span className="tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-white/40">No prospect store found.</p>
          )}
          <h3 className="mt-4 mb-1 text-xs font-semibold text-white/50 uppercase">Previews</h3>
          <ul className="space-y-1 text-sm">
            {t.previews.map((p) => (
              <li key={p.slug} className="flex justify-between gap-2">
                <a className="truncate underline decoration-white/20 hover:decoration-white" href={p.url} target="_blank" rel="noreferrer">{p.name}</a>
                <span className="shrink-0 text-xs text-white/40 max-sm:hidden">{p.lane} · exp {when(p.expires_at)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Latest log" right="freesite-roadmap.md">
          <ul className="space-y-2 text-xs text-white/60">
            {t.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {t.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/5">
                {l.label}
              </a>
            ))}
          </div>
        </Card>
      </div>
      {t.error ? <p className="text-xs text-rose-300">{t.error}</p> : null}
    </main>
  );
}
