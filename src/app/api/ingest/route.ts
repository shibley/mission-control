import { NextResponse } from "next/server";
import type { PrioritiesFile, Snapshot } from "@/lib/data";
import {
  blobConfigured,
  newer,
  readStoredPriorities,
  writeStoredPriorities,
  writeStoredSnapshot,
} from "@/lib/store";

export const dynamic = "force-dynamic";

// The Mac POSTs here every 5 minutes. Bearer token rather than the basic-auth
// gate the browser uses, so the pusher never has to carry Shib's password.
export async function POST(req: Request) {
  const expected = process.env.MC_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "MC_INGEST_TOKEN not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!blobConfigured()) {
    return NextResponse.json({ error: "blob store not connected" }, { status: 500 });
  }

  let body: { snapshot?: Snapshot };
  try {
    body = (await req.json()) as { snapshot?: Snapshot };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return NextResponse.json({ error: "snapshot required" }, { status: 400 });
  }

  // Last-write-wins on the ranking. The push carries the Mac's copy of
  // priorities.json, which is stale by up to 5 minutes — so if someone dragged
  // a row in the browser since the last push, the remote copy is newer and the
  // push must not clobber it. We hand the winner back and the pusher writes it
  // to disk, which is how a remote drag reaches ~/clawd/memory/priorities.json.
  const incoming = (snapshot.priorities ?? null) as PrioritiesFile | null;
  const remote = await readStoredPriorities();
  const winner = newer(incoming, remote);
  const appliedRemote = winner !== null && winner === remote && remote !== incoming;

  if (winner && !appliedRemote) await writeStoredPriorities(winner);

  const receivedAt = new Date().toISOString();
  await writeStoredSnapshot({
    generatedAt: snapshot.at ?? receivedAt,
    receivedAt,
    snapshot: winner ? { ...snapshot, priorities: winner } : snapshot,
  });

  return NextResponse.json({
    ok: true,
    receivedAt,
    // "remote" tells the pusher: your local file is behind, take this instead.
    applied: appliedRemote ? "remote" : "local",
    priorities: winner,
  });
}
