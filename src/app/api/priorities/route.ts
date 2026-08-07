import { NextResponse } from "next/server";
import type { Priority, PrioritiesFile } from "@/lib/data";
import {
  blobConfigured,
  readStoredPriorities,
  readStoredSnapshot,
  writeStoredPriorities,
  writeStoredSnapshot,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const onVercel = () => Boolean(process.env.VERCEL);

async function currentPriorities(): Promise<PrioritiesFile> {
  if (!onVercel()) {
    const { readPriorities } = await import("@/lib/data");
    return readPriorities();
  }
  const remote = await readStoredPriorities();
  if (remote) return remote;
  const stored = await readStoredSnapshot();
  return (
    stored?.snapshot.priorities ?? {
      lastUpdated: new Date(0).toISOString(),
      authoritative: false,
      items: [],
    }
  );
}

export async function GET() {
  return NextResponse.json(await currentPriorities());
}

// The whole ranked list is posted back at once — order of `items` is the ranking.
export async function POST(req: Request) {
  const body = (await req.json()) as { items?: Priority[]; authoritative?: boolean };
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }

  const current = await currentPriorities();

  if (!onVercel()) {
    const { writePriorities } = await import("@/lib/data");
    return NextResponse.json(
      writePriorities({
        ...current,
        authoritative: body.authoritative ?? current.authoritative,
        items: body.items,
      })
    );
  }

  if (!blobConfigured()) {
    return NextResponse.json({ error: "blob store not connected" }, { status: 500 });
  }

  // Stamped now, which is what makes this beat the next (older) push from the Mac.
  const saved: PrioritiesFile = {
    ...current,
    lastUpdated: new Date().toISOString(),
    authoritative: body.authoritative ?? current.authoritative,
    items: body.items,
  };
  await writeStoredPriorities(saved);

  // Keep the rendered snapshot consistent until the next push catches up.
  const stored = await readStoredSnapshot();
  if (stored) {
    await writeStoredSnapshot({
      ...stored,
      snapshot: { ...stored.snapshot, priorities: saved },
    });
  }

  return NextResponse.json(saved);
}
