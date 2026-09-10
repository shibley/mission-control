"use client";

import Link from "next/link";
import { useState } from "react";
import type { DmxCheck, DmxPanel, DmxSet, DmxSlide } from "@/lib/distributionmax";
import type { DashboardData } from "@/lib/source";

const STATUS_STYLE: Record<string, string> = {
  pass: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  fail: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  unconfigured: "bg-white/10 text-white/50 ring-white/15",
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
  return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function Check({ check }: { check: DmxCheck }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[check.status] ?? STATUS_STYLE.unconfigured;
  const label =
    check.status === "pass"
      ? "PASS"
      : check.status === "unconfigured"
        ? check.required
          ? (check.failLabel ?? "NOT SET").toUpperCase()
          : "OPTIONAL"
        : (check.failLabel ?? "FAIL").toUpperCase();

  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${style}`}>
          {label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            {check.label}
            {check.required ? <span className="ml-2 text-[10px] text-white/30">REQUIRED</span> : null}
          </span>
          <span className="mt-0.5 block text-xs text-white/45">{check.detail}</span>
        </span>
      </button>
      {open && check.remediation ? (
        <p className="mt-2 border-t border-white/10 pt-2 text-xs leading-relaxed text-white/50">
          {check.remediation}
        </p>
      ) : null}
    </li>
  );
}

function Slide({ slide, alt }: { slide: DmxSlide; alt: string }) {
  if (!slide.url) {
    return (
      <div className="flex aspect-9/16 items-center justify-center rounded-lg border border-dashed border-white/15 p-2 text-center text-[10px] text-white/30">
        not mirrored yet
      </div>
    );
  }
  return (
    <a href={slide.url} target="_blank" rel="noreferrer" className="block">
      {/* Plain <img>: these are arbitrary local/Blob files at unknown dimensions,
          and next/image would want every host allow-listed for no benefit here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.url}
        alt={alt}
        className="aspect-9/16 w-full rounded-lg border border-white/10 object-cover transition hover:border-white/30"
      />
    </a>
  );
}

function SetCard({ set }: { set: DmxSet }) {
  const missing = set.images.filter((s) => !s.url).length;
  const state = [
    `${set.slides} slides`,
    set.reel ? "reel" : "no reel",
    set.reviewed ? "reviewed" : "NOT REVIEWED",
    set.scheduled.length
      ? `scheduled → ${set.scheduled.map((s) => `${s.platform} ${s.when.slice(0, 16)}`).join(", ")}`
      : "unposted",
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm">{set.id}</h3>
            {set.dryRun ? (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-500/30">
                DRY RUN — placeholder photos, never post
              </span>
            ) : null}
            {set.packIsExample ? (
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300 ring-1 ring-rose-500/30">
                EXAMPLE PACK — someone else&rsquo;s product
              </span>
            ) : null}
            {set.faces ? (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 ring-1 ring-rose-500/40">
                {set.faces} FACE(S) WHERE THE FORMAT FORBIDS ONE
              </span>
            ) : null}
            {set.flagged ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                {set.flagged} flagged for text
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-white/40">
            {set.format}
            {set.character ? ` · ${set.character}` : ""} · pack {set.pack} · {state.join(" · ")}
          </p>
          {set.caption ? (
            <p className="mt-2 max-w-2xl text-sm text-white/70 italic">&ldquo;{set.caption}&rdquo;</p>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">
            {set.dryRun ? "free" : money(set.imageCalls * 0.0336)}
          </div>
          <div className="text-[11px] text-white/40">
            {set.dryRun ? "no image calls" : `${set.imageCalls} image calls`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {set.images.map((s) => (
          <Slide key={s.file} slide={s} alt={`${set.id} ${s.file}`} />
        ))}
      </div>

      {missing ? (
        <p className="mt-2 text-xs text-amber-300/70">
          {missing} of {set.images.length} slides not mirrored to Blob yet — the pusher uploads a
          few MB per run, so they arrive over the next few pushes.
        </p>
      ) : null}

      {set.contactSheet ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-white/40 hover:text-white/70">
            contact sheet (dmx review)
          </summary>
          <div className="mt-2 max-w-xl">
            <Slide slide={set.contactSheet} alt={`${set.id} contact sheet`} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function DistributionMax({ initial }: { initial: DashboardData }) {
  const dmx = initial.snapshot?.distributionmax as DmxPanel | undefined;

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">DistributionMax</h1>
          <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white/50 ring-1 ring-white/15">
            READ-ONLY
          </span>
        </div>
        <p className="mt-1 text-sm text-white/40">
          {dmx?.root ?? "distributionmax"} · generating and posting stay on the CLI
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
      >
        ← Mission Control
      </Link>
    </div>
  );

  // Absent on any snapshot pushed before this panel existed, which the main
  // dashboard tolerates too — it must read as "no data", not as a crash.
  if (!dmx) {
    return (
      <main className="mx-auto max-w-[1500px] p-6">
        {header}
        <Card title="No data">
          <p className="text-sm text-white/50">
            The pushed snapshot carries no distributionmax section. Either the Mac has not pushed
            since this page was added, or{" "}
            <code className="rounded bg-white/10 px-1">~/clawd/distributionmax</code> is not
            installed.
          </p>
        </Card>
      </main>
    );
  }

  const paid = dmx.sets.filter((s) => !s.dryRun);
  const totalCalls = paid.reduce((n, s) => n + s.imageCalls, 0);
  const unposted = paid.filter((s) => s.scheduled.length === 0).length;

  return (
    <main className="mx-auto max-w-[1500px] p-6">
      {header}

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[
          [`${paid.length}`, "sets generated"],
          [`${dmx.sets.length - paid.length}`, "dry runs (free)"],
          [`${unposted}`, "unposted"],
          [money(totalCalls * dmx.costPerImageCall), `spend · ${totalCalls} image calls`],
        ].map(([value, label]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-xs text-white/40">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card
            title="Setup — dmx doctor"
            right={
              <span>
                {dmx.doctor?.canGenerate ? "can generate" : "CANNOT GENERATE"} ·{" "}
                {dmx.doctor?.canSchedule ? "can schedule" : "hand-post"}
              </span>
            }
          >
            {dmx.error ? (
              <p className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{dmx.error}</p>
            ) : null}
            {dmx.doctor ? (
              <>
                <ul className="space-y-2">
                  {dmx.doctor.checks
                    .slice()
                    .sort((a, b) => Number(b.required) - Number(a.required))
                    .map((c) => (
                      <Check key={c.id} check={c} />
                    ))}
                </ul>
                {dmx.doctor.asks.length ? (
                  <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                    <div className="text-xs font-semibold text-amber-300">Still needs an answer</div>
                    <ul className="mt-1 space-y-1 text-xs text-white/60">
                      {dmx.doctor.asks.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-white/50">
                {dmx.installed ? "doctor returned nothing" : "not installed"}
              </p>
            )}
          </Card>

          <div className="mt-4">
            <Card title="Formats" right={`${money(dmx.costPerImageCall)}/image call`}>
              <ul className="space-y-2">
                {dmx.formats.map((f) => (
                  <li key={f.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm">{f.name}</span>
                      <span className="text-sm tabular-nums">
                        {money(f.imageCallsPerSet * dmx.costPerImageCall)}
                        {f.imageCallsPerSetAfterFirst !== f.imageCallsPerSet ? (
                          <span className="text-white/40">
                            {" "}
                            → {money(f.imageCallsPerSetAfterFirst * dmx.costPerImageCall)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/45">{f.description}</p>
                    <p className="mt-1 text-[11px] text-white/30">
                      {f.slides} slides · {f.imageCallsPerSet} image calls
                      {f.imageCallsPerSetAfterFirst !== f.imageCallsPerSet
                        ? `, ${f.imageCallsPerSetAfterFirst} after the character's first set`
                        : ""}
                      {f.needsPerson ? " · needs a character" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {dmx.sets.length ? (
            dmx.sets.map((s) => <SetCard key={s.dir} set={s} />)
          ) : (
            <Card title="Sets">
              <p className="text-sm text-white/50">
                Nothing generated yet. <code className="rounded bg-white/10 px-1">dmx generate</code>{" "}
                on the Mac; a{" "}
                <code className="rounded bg-white/10 px-1">--dry-run</code> costs nothing and shows
                up here too.
              </p>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
