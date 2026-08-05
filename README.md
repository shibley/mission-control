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

## Deliberately not here

No auth, no Vercel deploy. The panels carry MRR, Stripe counts and blocker detail, so it
stays on localhost until there's a reason to expose it. The `.vercel` link
(`prj_g3l37dbL9i6WGQzghhd8sYR1D8uy`) is left in place in case that changes.
