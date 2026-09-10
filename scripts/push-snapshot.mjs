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

// Mirror the distributionmax slides before the snapshot goes up, so the URLs the
// snapshot carries are already live when the page reads it.
//
// Vercel has no filesystem, so the only way the slides can be looked at remotely
// is a copy in Blob. Keys are content-addressed by the panel, which makes the
// upload incremental: a steady state re-uploads nothing, and only a fresh set or
// a `dmx regen` costs bandwidth. A byte budget per run keeps a first push of a
// large out/ from blowing the request limit — the rest arrives on later runs, and
// the page says so rather than showing a hole.
const MIRROR_BUDGET = 20 * 1024 * 1024;
const BATCH_BYTES = 3 * 1024 * 1024; // Vercel caps a request body at 4.5MB; base64 adds a third.

async function mirrorSlides() {
  const sets = snap.distributionmax?.sets ?? [];
  const wanted = [];
  for (const set of sets) {
    for (const img of [...set.images, ...(set.contactSheet ? [set.contactSheet] : [])]) {
      wanted.push({
        key: `${set.id}/${img.digest}-${img.file}`,
        abs: path.join(snap.distributionmax.root, set.dir, img.file),
        bytes: img.bytes,
        img,
      });
    }
  }
  if (!wanted.length) return;

  // Blank every URL up front. The panel filled them with this Mac's local route,
  // which does not exist on Vercel — shipping one unrewritten renders a broken
  // image instead of the honest "not mirrored yet". Anything the mirror confirms
  // is written back below.
  for (const w of wanted) w.img.url = null;

  const head = await fetch(`${URL_BASE}/api/ingest/slides`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!head.ok) {
    console.error(`push-snapshot: slide mirror unavailable (${head.status}) — snapshot still pushed`);
    return;
  }
  const have = (await head.json()).keys ?? {};

  const keep = wanted.map((w) => w.key);
  const todo = wanted.filter((w) => !have[w.key]);

  let spent = 0;
  let batch = [];
  let batchBytes = 0;
  const flush = async (withKeep) => {
    if (!batch.length && !withKeep) return;
    const res = await fetch(`${URL_BASE}/api/ingest/slides`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ files: batch, ...(withKeep ? { keep } : {}) }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    Object.assign(have, (await res.json()).urls ?? {});
    batch = [];
    batchBytes = 0;
  };

  try {
    for (const w of todo) {
      if (spent + w.bytes > MIRROR_BUDGET) break;
      if (batchBytes + w.bytes > BATCH_BYTES) await flush(false);
      batch.push({ key: w.key, base64: fs.readFileSync(w.abs).toString("base64") });
      batchBytes += w.bytes;
      spent += w.bytes;
    }
    // The last call carries the full key set, which is what authorises the prune.
    await flush(true);
  } catch (e) {
    console.error(`push-snapshot: slide mirror failed — ${e.message}`);
  }

  for (const w of wanted) w.img.url = have[w.key] ?? null;

  const remaining = wanted.filter((w) => !have[w.key]).length;
  console.log(
    `push-snapshot: slides ${wanted.length - remaining}/${wanted.length} mirrored` +
      (remaining ? ` · ${remaining} queued for a later run` : "")
  );
}

if (snap.distributionmax?.installed) await mirrorSlides();

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
