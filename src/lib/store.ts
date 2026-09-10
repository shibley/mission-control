import { put, list, del } from "@vercel/blob";
import type { PrioritiesFile, Snapshot } from "./data";

// Vercel-side persistence. The dashboard has no filesystem to read on Vercel,
// so the Mac pushes a snapshot every 5 minutes into Blob and the pages read it
// back. Two objects, deliberately separate:
//
//   snapshot.json   — everything the panels render, replaced wholesale by the pusher
//   priorities.json — the ranked list, which can be edited from *either* side
//
// Splitting them is what makes the drag-and-drop survive: a reorder done in the
// browser writes only priorities.json, so the next push (which carries a stale
// copy of the ranking) can be told to back off by timestamp instead of winning
// just because it arrived later.

// Every write gets a fresh, sortable pathname instead of overwriting one key.
// Overwriting looked simpler but is unusable here: blob bodies are served from
// a CDN with a floor on the cache TTL, so a re-read within ~a minute returns the
// previous body. That is precisely the window in which a browser reorder and the
// 5-minute push race, and a stale read there means the push silently clobbers
// the drag. Immutable keys make every read exact — the newest pathname wins.
const SNAPSHOT_PREFIX = "mission-control/snapshot/";
const PRIORITIES_PREFIX = "mission-control/priorities/";

// Slide mirror. Vercel has no filesystem, so the distributionmax slides the Mac
// generated are copied here for the /distributionmax page to display. Keys are
// content-addressed (<set-id>/<sha1-8>-<file>), which buys the same immutability
// the JSON keys get *and* lets the pusher skip anything already uploaded — these
// are hundreds of KB each and the push runs every 5 minutes.
const SLIDE_PREFIX = "mission-control/dmx/";

// Enough history to debug a bad push, few enough to stay tiny.
const KEEP = 3;

export type StoredSnapshot = {
  // When the Mac collected the data. This is the number that matters for staleness.
  generatedAt: string;
  // When Vercel accepted the push. Diverges from generatedAt if a push is retried.
  receivedAt: string;
  snapshot: Snapshot;
};

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Sortable, collision-proof key: lexicographic order == chronological order. */
function versionKey(prefix: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}${stamp}-${Math.random().toString(36).slice(2, 8)}.json`;
}

async function writeJson(prefix: string, value: unknown) {
  await put(versionKey(prefix), JSON.stringify(value), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    // The key is never reused, so the body can be cached forever.
    cacheControlMaxAge: 31_536_000,
  });
  await prune(prefix);
}

async function prune(prefix: string) {
  try {
    const { blobs } = await list({ prefix, limit: 200 });
    const stale = sortNewestFirst(blobs).slice(KEEP);
    if (stale.length) await del(stale.map((b) => b.url));
  } catch {
    // Housekeeping only — a failed prune must never fail a write.
  }
}

function sortNewestFirst<T extends { pathname: string }>(blobs: T[]) {
  return blobs.slice().sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
}

async function readJson<T>(prefix: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix, limit: 200 });
    const latest = sortNewestFirst(blobs)[0];
    if (!latest) return null;
    const res = await fetch(latest.url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const readStoredSnapshot = () => readJson<StoredSnapshot>(SNAPSHOT_PREFIX);
export const readStoredPriorities = () => readJson<PrioritiesFile>(PRIORITIES_PREFIX);

export type MirroredSlide = { key: string; url: string };

/** Every mirrored slide, keyed by the content-addressed key the pusher sends. */
export async function listMirroredSlides(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: SLIDE_PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) found.set(b.pathname.slice(SLIDE_PREFIX.length), b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

export async function writeMirroredSlide(key: string, body: Buffer, contentType: string) {
  const { url } = await put(`${SLIDE_PREFIX}${key}`, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    // Content-addressed, so this body can never change.
    cacheControlMaxAge: 31_536_000,
  });
  return url;
}

/**
 * Drop mirrored slides the Mac no longer has. `keep` is the pusher's complete
 * current key set, so anything outside it belongs to a deleted or regenerated
 * set — without this the mirror only ever grows.
 */
export async function pruneMirroredSlides(keep: Set<string>) {
  try {
    const have = await listMirroredSlides();
    const stale = [...have].filter(([k]) => !keep.has(k)).map(([, url]) => url);
    for (let i = 0; i < stale.length; i += 100) await del(stale.slice(i, i + 100));
    return stale.length;
  } catch {
    return 0;
  }
}

export const writeStoredSnapshot = (v: StoredSnapshot) => writeJson(SNAPSHOT_PREFIX, v);
export const writeStoredPriorities = (v: PrioritiesFile) => writeJson(PRIORITIES_PREFIX, v);

/** Newer `lastUpdated` wins; a missing or unparseable timestamp always loses. */
export function newer(a: PrioritiesFile | null, b: PrioritiesFile | null): PrioritiesFile | null {
  const t = (f: PrioritiesFile | null) => {
    const ms = f ? Date.parse(f.lastUpdated ?? "") : NaN;
    return Number.isNaN(ms) ? -1 : ms;
  };
  if (!a) return b;
  if (!b) return a;
  return t(b) > t(a) ? b : a;
}
