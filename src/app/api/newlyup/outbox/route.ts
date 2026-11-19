import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refuseUnlessLocal } from "@/lib/local-gate";

export const dynamic = "force-dynamic";
const run = promisify(execFile);

// Shib's approve / skip / edit on /newlyup. Every write goes through freesite's own CLI (scripts/nu-track.mjs outbox …,
// lib/outbox.mjs) so the dashboard never carries a second copy of the status rules. Local Mac only (lib/local-gate).
// send-anyway: a row outbox-worker held because a similar message went to the lead in the last 12h (`outbox force`).
// undo: Undo after Approve, back to pending unless the worker already claimed it (`outbox unapprove`).
// retry: a failed row back to approved (`outbox retry`; the card asks Shib to check the thread first).
type Action = "approve-now" | "approve-suggested" | "skip" | "save" | "send-anyway" | "undo" | "retry";
type Body = { id?: number; action?: Action; text?: string };

// GET ?ids=1,2,3 -> {items}: the card status poll (every 5s while a card is approved/scheduled/sending). Reads only
// those rows from freesite.db, read-only; local Mac only like the writes.
export async function GET(req: Request) {
  const refused = refuseUnlessLocal(req, { write: false });
  if (refused) return refused;
  const ids = (new URL(req.url).searchParams.get("ids") || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const { ROOT } = await import("@/lib/data");
  const { readOutboxItems } = await import("@/lib/newlyup");
  const items = readOutboxItems(ROOT, ids);
  if (!items) return NextResponse.json({ error: "freesite.db unreadable" }, { status: 503 });
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const refused = refuseUnlessLocal(req);
  if (refused) return refused;
  const { ROOT } = await import("@/lib/data");
  const body = (await req.json().catch(() => ({}))) as Body;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });

  const verb = ({ "approve-now": "approve", "approve-suggested": "approve", skip: "skip", save: "edit", "send-anyway": "force", undo: "unapprove", retry: "retry" } as Record<string, string>)[body.action ?? ""];
  if (!verb) return NextResponse.json({ error: "action must be approve-now|approve-suggested|skip|save|send-anyway|undo|retry" }, { status: 400 });
  const args = [path.join(ROOT, "freesite/scripts/nu-track.mjs"), "outbox", verb, String(id)];
  if (body.action === "approve-suggested") args.push("--at", "suggested");
  if (body.action === "skip") args.push("--reason", "skipped by Shib on /newlyup");

  // Text goes through a file: a draft can start with "--" or hold anything argv would mangle.
  let tmp: string | null = null;
  if ((verb === "approve" || verb === "edit") && typeof body.text === "string" && body.text.trim()) {
    tmp = path.join(os.tmpdir(), `mc-outbox-${id}-${Date.now()}.txt`);
    fs.writeFileSync(tmp, body.text);
    args.push("--text-file", tmp);
  } else if (verb === "edit") {
    return NextResponse.json({ error: "save needs text" }, { status: 400 });
  }
  try {
    const { stdout } = await run(process.execPath, args, { cwd: path.join(ROOT, "freesite"), timeout: 20_000 });
    return NextResponse.json({ ok: true, item: JSON.parse(stdout.trim().split("\n").pop() || "null") });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    // freesite's entity auto-fix note ("outbox: decoded HTML entity …") is stderr too; it is never the error.
    const lines = (err.stderr || err.message).trim().split("\n").filter((l) => l && !l.startsWith("outbox: decoded"));
    return NextResponse.json({ error: lines[0] || err.message }, { status: 400 });
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
