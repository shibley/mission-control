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
type Body = { id?: number; action?: "approve-now" | "approve-suggested" | "skip" | "save" | "send-anyway"; text?: string };

export async function POST(req: Request) {
  const refused = refuseUnlessLocal(req);
  if (refused) return refused;
  const { ROOT } = await import("@/lib/data");
  const body = (await req.json().catch(() => ({}))) as Body;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });

  const verb = ({ "approve-now": "approve", "approve-suggested": "approve", skip: "skip", save: "edit", "send-anyway": "force" } as Record<string, string>)[body.action ?? ""];
  if (!verb) return NextResponse.json({ error: "action must be approve-now|approve-suggested|skip|save|send-anyway" }, { status: 400 });
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
    return NextResponse.json({ error: (err.stderr || err.message).trim().split("\n")[0] }, { status: 400 });
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
