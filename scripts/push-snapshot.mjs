#!/usr/bin/env node
// Pushes a fresh snapshot of this Mac to the Vercel dashboard, and pulls back
// any priority reorder that was done in the browser since the last run.
//
// Runs every 5 minutes from launchd (com.bity.mission-control-push).
// Config comes from scripts/push.env, which is gitignored because it holds the
// ingest token:
//     MC_URL=https://…vercel.app
//     MC_INGEST_TOKEN=…
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));

// data.ts resolves ~/clawd from cwd, and launchd does not guarantee one, so pin
// it before that module is evaluated.
process.env.CLAWD_ROOT ||= path.resolve(here, "../../..");
const { snapshot, readPriorities, ROOT } = await import("../src/lib/data.ts");

// Minimal KEY=value reader — no dependency, and the file is ours.
for (const line of readIfPresent(path.join(here, "push.env")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

const URL_BASE = (process.env.MC_URL || "").replace(/\/$/, "");
const TOKEN = process.env.MC_INGEST_TOKEN;
if (!URL_BASE || !TOKEN) {
  console.error("push-snapshot: MC_URL and MC_INGEST_TOKEN required (scripts/push.env)");
  process.exit(1);
}

const snap = snapshot();

const res = await fetch(`${URL_BASE}/api/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ snapshot: snap }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`push-snapshot: ${res.status} ${text.slice(0, 300)}`);
  process.exit(1);
}

const out = JSON.parse(text);

// applied === "remote" means someone dragged the list in the browser and that
// ordering is newer than ours, so the file on disk is the stale one. Write it
// back, which is the only path by which a remote reorder reaches
// ~/clawd/memory/priorities.json.
if (out.applied === "remote" && Array.isArray(out.priorities?.items)) {
  const local = readPriorities();
  // Written raw rather than through writePriorities(), which re-stamps
  // lastUpdated — that would make this copy look newer than the remote edit it
  // came from and the two sides would ping-pong forever.
  const target = path.join(ROOT, "memory", "priorities.json");
  fs.writeFileSync(target, JSON.stringify({ ...local, ...out.priorities }, null, 2) + "\n");
  console.log(`push-snapshot: pulled remote ranking (${out.priorities.items.length} items)`);
}

console.log(
  `push-snapshot: ok at ${out.receivedAt} · applied=${out.applied} · ` +
    `${snap.repos.length} repos, ${snap.priorities.items.length} priorities`
);
