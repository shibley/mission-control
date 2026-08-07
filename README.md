# Mission Control

Local-only project dashboard for the Bity portfolio. Rebuilt 2026-08-05 (the Feb version
was a read-only board fed by a `memory/mission-control.md` that no longer exists).

```bash
cd ~/clawd/projects/mission-control && npm run dev   # http://localhost:3000
```

## What it reads

Everything is read live from `~/clawd` on each request — there is no sync step and no
copied data to go stale. Override the workspace path with `CLAWD_ROOT`.

| Panel | Source |
|---|---|
| MRR & funnel | `memory/watchdog/YYYY-MM-DD.json` (production-watchdog output: Stripe + beacon warehouse) |
| Sprints | `memory/work-rotation.json`, `memory/coding-sprint-state.json`, `memory/sprint-eval-log.jsonl` |
| Needs Shib | `memory/blockers.md` |
| Repos | `git` in each portfolio repo (unpushed / dirty / last commit) |
| Research threads | `memory/mrr-research-queue.md` (open threads above the `## Log` section) |
| Priorities | `memory/priorities.json` — **read AND written** |

## Priorities

The order of `items[]` in `memory/priorities.json` **is** the ranking. Drag a row (or use
the up/down buttons) and it saves immediately; the status dropdown writes through the same way.

`authoritative: false` today, which means the work-sprint and coding-sprint crons do **not**
read the file — BillyBob reads it when choosing what to pick up. Flipping it to `true` only
makes sense once the rotation writer is wired to honour the order, and only on Shib's word.

## Remote copy (Vercel)

<https://mission-control-woad-five.vercel.app> — permanent URL, behind HTTP basic auth
(`src/middleware.ts`, enforced only when `MC_PASSWORD` is set, so `npm run dev` stays open).
This replaced an ngrok tunnel whose hostname changed on every restart.

Vercel has none of the files or repos the panels read, so the Mac pushes to it:

```
launchd com.bity.mission-control-push   (every 5 min, plist copy in scripts/)
  └─ scripts/push-snapshot.mjs
       ├─ collects via src/lib/data.ts    ← same code the local dashboard uses,
       │                                    imported directly; Node strips the types,
       │                                    so the two can never drift
       └─ POST /api/ingest (Bearer MC_INGEST_TOKEN) → Vercel Blob
```

`src/lib/source.ts` picks the source: on the Mac it reads the filesystem live as before,
on Vercel it reads the pushed snapshot. The header shows the snapshot's age and turns red
past 15 minutes, so a dead pusher can't be mistaken for a quiet portfolio.
`scripts/build-snapshot.mjs` prints the same blob to stdout for debugging.

Config lives in `scripts/push.env` (gitignored — it holds the ingest token):

```
MC_URL=https://mission-control-woad-five.vercel.app
MC_INGEST_TOKEN=…            # matches the Vercel env var of the same name
```

### Why the blob keys are versioned

Blob bodies are CDN-served with a floor on the cache TTL, so overwriting one fixed key
returns the *previous* body for up to a minute after a write. That window is exactly where
a browser reorder and the 5-minute push race, and a stale read there loses the drag. So
every write goes to a new sortable pathname under `mission-control/{snapshot,priorities}/`
and reads take the newest; the last 3 are kept.

### Reordering from either side

The ranking can be edited in the browser (Vercel) or by editing the file on the Mac.
Newest `lastUpdated` wins: a push carrying an older ranking is refused and handed the
remote one instead, which `push-snapshot.mjs` then writes into `memory/priorities.json`.
Verified in both directions.

The local dashboard on :4321 and its ngrok tunnel are untouched and still read live.
