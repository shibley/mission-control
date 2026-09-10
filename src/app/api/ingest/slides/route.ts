import { NextResponse } from "next/server";
import {
  blobConfigured,
  listMirroredSlides,
  pruneMirroredSlides,
  writeMirroredSlide,
} from "@/lib/store";

export const dynamic = "force-dynamic";

// The slide mirror the /distributionmax page reads on Vercel. Same bearer token
// as /api/ingest — it is the same pusher, and the browser's basic-auth password
// must never end up in a launchd job. Both paths are excluded from the
// middleware matcher by the `api/ingest` prefix.
function authorized(req: Request) {
  const expected = process.env.MC_INGEST_TOKEN;
  return Boolean(expected) && req.headers.get("authorization") === `Bearer ${expected}`;
}

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

// The pusher asks what is already mirrored so it can upload only the difference.
// Content-addressed keys make that a pure set comparison.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "blob store not connected" }, { status: 500 });
  const have = await listMirroredSlides();
  return NextResponse.json({ keys: Object.fromEntries(have) });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "blob store not connected" }, { status: 500 });

  let body: { files?: { key: string; base64: string }[]; keep?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const urls: Record<string, string> = {};
  for (const f of body.files ?? []) {
    // The key becomes a Blob pathname, so a "../" in it would write outside the prefix.
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(f.key)) {
      return NextResponse.json({ error: `bad key: ${f.key}` }, { status: 400 });
    }
    const ext = f.key.split(".").pop()?.toLowerCase() ?? "";
    if (!TYPES[ext]) return NextResponse.json({ error: `bad type: ${f.key}` }, { status: 400 });
    urls[f.key] = await writeMirroredSlide(f.key, Buffer.from(f.base64, "base64"), TYPES[ext]);
  }

  // Only prune on a run that declared the full key set — a partial upload batch
  // must not be read as "the Mac has nothing else".
  const pruned = Array.isArray(body.keep) ? await pruneMirroredSlides(new Set(body.keep)) : 0;

  return NextResponse.json({ ok: true, stored: Object.keys(urls).length, pruned, urls });
}
