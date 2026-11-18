import { NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { refuseUnlessLocal } from "@/lib/local-gate";

export const dynamic = "force-dynamic";
const run = promisify(execFile);

// Lead-level actions from a /newlyup "Needs you" row (phase 2, 2026-11-18). Local Mac only (lib/local-gate).
//   snooze  {key, until}         -> nu-track lead snooze (next_action_at; hidden from Needs you until then)
//   lost    {key, reason}        -> nu-track lead lost (stage lost, pending drafts skipped)
//   redraft {key, instruction}   -> starts freesite scripts/nu-redraft.mjs in the background (one agent turn that only
//                                   drafts); returns {job}. GET ?job=<id> reads its status until the pending outbox row exists.
//                                   {default: true} = no instruction, "draft the best next reply per the playbook" (Draft now).
//   autodraft {keys}             -> freesite scripts/nu-autodraft.mjs: "Needs you" rows without a draft get one, at most once
//                                   per lead per inbound message; returns {results:[{lead,status,job}]} (jobs run detached).
type Body = {
  key?: string;
  keys?: string[];
  action?: "snooze" | "lost" | "redraft" | "autodraft";
  until?: string;
  reason?: string;
  instruction?: string;
  default?: boolean;
};

const KEY = /^[a-z0-9][a-z0-9-]{0,80}$/;
// nu-redraft shells out to `openclaw`, which lives in Homebrew's bin (not on launchd's PATH).
const childEnv = () => ({
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${
    process.env.PATH || "/usr/bin:/bin"
  }`,
});
const JOB = /^[a-z0-9-]{1,120}$/;

export async function POST(req: Request) {
  const refused = refuseUnlessLocal(req);
  if (refused) return refused;
  const { ROOT } = await import("@/lib/data");
  const freesite = path.join(ROOT, "freesite");
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.action === "autodraft") {
    const keys = (Array.isArray(body.keys) ? body.keys : [])
      .map(String)
      .filter((k) => KEY.test(k))
      .slice(0, 40);
    if (!keys.length) return NextResponse.json({ results: [] });
    try {
      const { stdout } = await run(
        process.execPath,
        [
          path.join(freesite, "scripts/nu-autodraft.mjs"),
          ...keys.flatMap((k) => ["--lead", k]),
        ],
        { cwd: freesite, timeout: 20_000, env: childEnv() },
      );
      return NextResponse.json(
        JSON.parse(stdout.trim().split("\n").pop() || "{}"),
      );
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      return NextResponse.json(
        { error: (err.stderr || err.message).trim().split("\n")[0] },
        { status: 500 },
      );
    }
  }
  const key = String(body.key || "");
  if (!KEY.test(key))
    return NextResponse.json({ error: "lead key required" }, { status: 400 });

  if (body.action === "redraft") {
    const instruction = String(body.instruction || "").trim();
    if (!instruction && !body.default)
      return NextResponse.json(
        { error: "type what you want the message to say" },
        { status: 400 },
      );
    if (instruction.length > 2000)
      return NextResponse.json(
        { error: "instruction too long (2000 chars max)" },
        { status: 400 },
      );
    const job = `${key}-${Date.now()}`;
    const ins = path.join(os.tmpdir(), `nu-redraft-ins-${job}.txt`);
    if (instruction) fs.writeFileSync(ins, instruction);
    const jobs = path.join(freesite, "data/redraft");
    fs.mkdirSync(jobs, { recursive: true });
    fs.writeFileSync(
      path.join(jobs, `${job}.json`),
      JSON.stringify({
        status: "drafting",
        lead_key: key,
        started_at: new Date().toISOString(),
      }),
    );
    // Detached: the agent turn takes ~30-90s, longer than a request should hang. Its log sits next to the job file.
    const out = fs.openSync(path.join(jobs, `${job}.log`), "a");
    const child = spawn(
      process.execPath,
      [
        path.join(freesite, "scripts/nu-redraft.mjs"),
        "--lead",
        key,
        ...(instruction ? ["--instruction-file", ins] : ["--default"]),
        "--job",
        job,
      ],
      {
        cwd: freesite,
        detached: true,
        stdio: ["ignore", out, out],
        env: childEnv(),
      },
    );
    child.unref();
    return NextResponse.json({ ok: true, job });
  }

  const args = [path.join(freesite, "scripts/nu-track.mjs"), "lead"];
  if (body.action === "snooze") {
    if (!body.until || Number.isNaN(Date.parse(body.until)))
      return NextResponse.json({ error: "pick a date" }, { status: 400 });
    args.push(
      "snooze",
      key,
      "--until",
      new Date(body.until).toISOString(),
      "--reason",
      "snoozed by Shib on /newlyup",
    );
  } else if (body.action === "lost") {
    const reason = String(body.reason || "").trim();
    if (!reason)
      return NextResponse.json(
        { error: "a reason is required" },
        { status: 400 },
      );
    args.push("lost", key, "--reason", reason.replace(/^--+/, ""));
  } else {
    return NextResponse.json(
      { error: "action must be snooze|lost|redraft|autodraft" },
      { status: 400 },
    );
  }
  try {
    const { stdout } = await run(process.execPath, args, {
      cwd: freesite,
      timeout: 20_000,
    });
    return NextResponse.json({
      ok: true,
      lead: JSON.parse(stdout.trim().split("\n").pop() || "null"),
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return NextResponse.json(
      { error: (err.stderr || err.message).trim().split("\n")[0] },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  const refused = refuseUnlessLocal(req, { write: false });
  if (refused) return refused;
  const { ROOT } = await import("@/lib/data");
  const job = new URL(req.url).searchParams.get("job") || "";
  if (!JOB.test(job))
    return NextResponse.json({ error: "job required" }, { status: 400 });
  try {
    const j = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "freesite/data/redraft", `${job}.json`),
        "utf8",
      ),
    );
    // A job file stuck at drafting for 8+ minutes means the process died (the agent call times out at 6).
    if (
      j.status === "drafting" &&
      Date.now() - Date.parse(j.started_at) > 8 * 60e3
    ) {
      j.status = "failed";
      j.error = "redraft timed out";
    }
    return NextResponse.json(j);
  } catch {
    return NextResponse.json({ status: "unknown" }, { status: 404 });
  }
}
