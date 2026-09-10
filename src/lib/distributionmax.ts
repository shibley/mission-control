import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// distributionmax is a separate vendor repo living beside the others in ~/clawd.
// It is read-only from here: this dashboard renders what the engine reports and
// never drives it, because generating costs Gemini calls and posting is outward-facing.
//
// The clawd root is passed in rather than imported from ./data, which would be a
// cycle — data.ts is what calls this.
export const dmxRoot = (clawdRoot: string) =>
  process.env.DMX_ROOT || path.join(clawdRoot, "distributionmax");

// Gemini image call, as billed. Every other slide in a set is drawn locally and is free,
// so this number times the format's image-call count is the whole cost of a set.
export const COST_PER_IMAGE_CALL = 0.0336;

export type DmxCheck = {
  id: string;
  label: string;
  required: boolean;
  status: "pass" | "fail" | "unconfigured" | string;
  detail: string;
  remediation?: string;
  failLabel?: string;
};

export type DmxDoctor = {
  ok: boolean;
  canGenerate: boolean;
  canSchedule: boolean;
  checks: DmxCheck[];
  asks: string[];
};

export type DmxFormat = {
  name: string;
  description: string;
  slides: number;
  imageCallsPerSet: number;
  imageCallsPerSetAfterFirst: number;
  needsPerson: boolean;
};

export type DmxSlide = {
  file: string;
  /** Where the browser can fetch it. Rewritten to a Blob URL by the pusher; null once mirrored-but-not-yet-uploaded. */
  url: string | null;
  bytes: number;
  /** sha1-8 of the bytes. The mirror is content-addressed, so this is also the Blob key. */
  digest: string;
};

export type DmxSet = {
  id: string;
  dir: string;
  format: string;
  character?: string;
  pack: string;
  packIsExample: boolean;
  slides: number;
  caption?: string;
  reviewed: boolean;
  reel: boolean;
  scheduled: { platform: string; when: string; handle: string }[];
  flagged: number;
  faces: number;
  createdAt: string;
  /** A dry run makes no image calls, so it is free and must never be posted. */
  dryRun: boolean;
  /** Image calls this set actually billed. 0 for a dry run. */
  imageCalls: number;
  images: DmxSlide[];
  /** The contact sheet `dmx review` builds, when one exists. */
  contactSheet: DmxSlide | null;
};

export type DmxPanel = {
  root: string;
  installed: boolean;
  doctor: DmxDoctor | null;
  formats: DmxFormat[];
  sets: DmxSet[];
  costPerImageCall: number;
  /** Non-null when the engine is installed but something went wrong reading it. */
  error: string | null;
};

function dmxJson<T>(DMX_ROOT: string, args: string[]): T | null {
  const out = execFileSync(
    path.join(DMX_ROOT, "node_modules", ".bin", "tsx"),
    [path.join(DMX_ROOT, "src", "cli", "index.ts"), ...args, "--json"],
    { cwd: DMX_ROOT, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }
  );
  // `dmx sets` prints a human sentence rather than JSON when out/ is missing,
  // which is the normal state before anything has been generated.
  const start = out.indexOf("{");
  if (start < 0) return null;
  return JSON.parse(out.slice(start)) as T;
}

function digestOf(file: string) {
  // Content-addressed so the mirror can skip a re-upload, and so `dmx regen`
  // replacing one slide changes exactly one key instead of invalidating the set.
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8);
}

function imageFile(DMX_ROOT: string, setDir: string, file: string): DmxSlide | null {
  const abs = path.join(DMX_ROOT, setDir, file);
  let bytes: number;
  try {
    bytes = fs.statSync(abs).size;
  } catch {
    return null;
  }
  const digest = digestOf(abs);
  return {
    file,
    bytes,
    digest,
    // Path relative to distributionmax/, which is what the local route range-checks.
    url: `/api/distributionmax/slide?f=${encodeURIComponent(path.join(setDir, file))}&v=${digest}`,
  };
}

function imagesFor(DMX_ROOT: string, setDir: string) {
  let files: string[] = [];
  try {
    files = fs.readdirSync(path.join(DMX_ROOT, setDir));
  } catch {
    return { images: [], contactSheet: null };
  }
  const slides = files
    .filter((f) => /^slide-\d+\.(jpg|jpeg|png)$/i.test(f))
    .sort()
    .map((f) => imageFile(DMX_ROOT, setDir, f))
    .filter((s): s is DmxSlide => s !== null);
  const sheet = files.includes("review.jpg") ? imageFile(DMX_ROOT, setDir, "review.jpg") : null;
  return { images: slides, contactSheet: sheet };
}

type SetsReport = { sets: Omit<DmxSet, "dryRun" | "imageCalls" | "images" | "contactSheet">[] };

/**
 * Image calls billed. The engine keeps a character's reference face after the
 * first set, so every later set for that character is one call cheaper — which
 * is why this cannot be a flat per-format multiplication.
 */
function billed(sets: { format: string; character?: string; createdAt: string }[], formats: DmxFormat[]) {
  const byName = new Map(formats.map((f) => [f.name, f]));
  const seen = new Set<string>();
  return sets
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .reduce((acc, s) => {
      const f = byName.get(s.format);
      if (!f) return acc;
      const key = `${s.format}:${s.character ?? ""}`;
      const first = !seen.has(key);
      seen.add(key);
      acc.set(
        s.createdAt + s.format + (s.character ?? ""),
        first ? f.imageCallsPerSet : f.imageCallsPerSetAfterFirst
      );
      return acc;
    }, new Map<string, number>());
}

export function distributionmaxPanel(clawdRoot: string): DmxPanel {
  const DMX_ROOT = dmxRoot(clawdRoot);
  const base: DmxPanel = {
    root: DMX_ROOT,
    installed: fs.existsSync(path.join(DMX_ROOT, "package.json")),
    doctor: null,
    formats: [],
    sets: [],
    costPerImageCall: COST_PER_IMAGE_CALL,
    error: null,
  };
  if (!base.installed) return base;

  try {
    base.doctor = dmxJson<DmxDoctor>(DMX_ROOT, ["doctor"]);
    base.formats = dmxJson<{ formats: DmxFormat[] }>(DMX_ROOT, ["formats"])?.formats ?? [];

    // `dmx sets` skips out/dry deliberately, but a dry run is the free iteration
    // loop and is exactly what there is to look at before anything is paid for,
    // so both roots are read and the dry ones are labelled rather than hidden.
    const live = dmxJson<SetsReport>(DMX_ROOT, ["sets"])?.sets ?? [];
    const dry = dmxJson<SetsReport>(DMX_ROOT, ["sets", "--out", "out/dry"])?.sets ?? [];
    const calls = billed(live, base.formats);

    base.sets = [...live.map((s) => ({ s, dry: false })), ...dry.map((s) => ({ s, dry: true }))]
      .map(({ s, dry: isDry }) => ({
        ...s,
        dryRun: isDry,
        imageCalls: isDry ? 0 : (calls.get(s.createdAt + s.format + (s.character ?? "")) ?? 0),
        ...imagesFor(DMX_ROOT, s.dir),
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }

  return base;
}
