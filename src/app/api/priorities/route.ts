import { NextResponse } from "next/server";
import { readPriorities, writePriorities, type Priority } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(readPriorities());
}

// The whole ranked list is posted back at once — order of `items` is the ranking.
export async function POST(req: Request) {
  const body = (await req.json()) as { items?: Priority[]; authoritative?: boolean };
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "items[] required" }, { status: 400 });
  }
  const current = readPriorities();
  const saved = writePriorities({
    ...current,
    authoritative: body.authoritative ?? current.authoritative,
    items: body.items,
  });
  return NextResponse.json(saved);
}
