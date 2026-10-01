import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Research tab. Everything here is parsed out of files the research crons already
// write, at render/snapshot time — there is no hand-maintained copy to go stale.
//
// These files are free-form markdown that agents append to, so every parser is
// written to skip what it doesn't recognise rather than throw: a malformed entry
// costs one row, never the page.
//
// The clawd root is passed in rather than imported from ./data, which would be a
// cycle — data.ts is what calls this.

export const MRR_RESEARCH_JOB = "0c215bd5-912d-475d-9d1a-2bd835870631";

export type Verdict = "REPLICATE" | "PARTIAL" | "NO";

export type ReplicationQueueItem = {
  title: string;
  state: "pending" | "in-progress" | "done";
  /** The claim / DONE line under the item, when there is one. */
  note: string | null;
};

export type ReplicationEntry = {
  date: string | null;
  company: string;
  verdict: Verdict | null;
  /** The "(mrr-research cron)" style suffix on the heading. */
  by: string | null;
  reason: string | null;
  doc: string | null;
};

export type ReplicateBrief = {
  file: string;
  title: string;
  status: string | null;
  awaiting: boolean;
};

export type CronRun = {
  at: string | null;
  status: string;
  durationMs: number | null;
  model: string | null;
  error: string | null;
  summary: string | null;
};

export type ResearchEval = { ts: string; score: number; sprintType: string; goal: string | null };

export type BacklogThread = { id: string; title: string; priority: string | null };

export type ResearchTab = {
  replication: { queue: ReplicationQueueItem[]; entries: ReplicationEntry[]; error: string | null };
  briefs: ReplicateBrief[];
  cron: { jobId: string; runs: CronRun[]; error: string | null };
  evals: ResearchEval[];
  backlog: BacklogThread[];
};

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function clip(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : one;
}

/** The body of a `## heading` section, up to the next `## `. Empty when absent. */
function section(text: string, heading: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && heading.test(l));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const VERDICT_RE = /\b(REPLICATE|PARTIAL|NO)\b/;

// ---------- 1. agentic-replication-log.md ----------

function replicationQueue(text: string): ReplicationQueueItem[] {
  const out: ReplicationQueueItem[] = [];
  for (const line of section(text, /Queue/i).split("\n")) {
    const top = line.match(/^-\s+(.+)$/);
    if (top) {
      const title = top[1].trim();
      out.push({
        title,
        state: /IN[ -]PROGRESS|CLAIMED/i.test(title) ? "in-progress" : /^~~|\bDONE\b/.test(title) ? "done" : "pending",
        note: null,
      });
      continue;
    }
    const child = line.match(/^\s+[-*]\s+(.+)$/);
    const parent = out[out.length - 1];
    if (!child || !parent) continue;
    const note = child[1].trim();
    // A later DONE line outranks an earlier claim on the same item.
    if (/\bDONE\b/.test(note)) parent.state = "done";
    else if (/IN[ -]PROGRESS|CLAIMED/i.test(note) && parent.state !== "done") parent.state = "in-progress";
    parent.note = note;
  }
  return out;
}

function replicationEntries(text: string): ReplicationEntry[] {
  const body = section(text, /Entries/i);
  const blocks = body.split(/^(?=###\s)/m).filter((b) => /^###\s/.test(b));
  const out: ReplicationEntry[] = [];
  for (const block of blocks) {
    try {
      const [head, ...rest] = block.split("\n");
      const parts = head.replace(/^###\s+/, "").split(/\s+·\s+/).map((p) => p.trim());
      const date = /^\d{4}-\d{2}-\d{2}/.test(parts[0] ?? "") ? parts.shift()!.slice(0, 10) : null;

      // The verdict is the last part that starts with one; everything between the
      // date and it is the company (which may itself contain a "·").
      let vIdx = -1;
      for (let i = parts.length - 1; i >= 0; i--) if (/^(REPLICATE|PARTIAL|NO)\b/.test(parts[i])) { vIdx = i; break; }
      const vPart = vIdx >= 0 ? parts[vIdx] : null;
      const company = (vIdx >= 0 ? parts.slice(0, vIdx) : parts).join(" · ") || "(unnamed)";
      const verdict = (vPart?.match(VERDICT_RE)?.[1] as Verdict | undefined) ?? null;
      const by = vPart?.match(/\(([^)]*)\)/)?.[1] ?? null;

      const bullets = rest.map((l) => l.match(/^\s*-\s+(.+)$/)?.[1]).filter((l): l is string => !!l);
      const verdictLine = bullets.find((l) => /^Verdict\b/i.test(l));
      const reason = verdictLine
        ? verdictLine.replace(/^Verdict\s*[:\-]?\s*(REPLICATE|PARTIAL|NO)?\s*[.:\-—]*\s*/i, "")
        : (bullets.find((l) => /decisive|decided/i.test(l)) ?? null);
      const doc = bullets
        .find((l) => /^Doc\s*:/i.test(l))
        ?.replace(/^Doc\s*:\s*/i, "")
        .replace(/[`*]/g, "")
        .trim() ?? null;

      out.push({ date, company, verdict, by, reason: clip(reason, 220), doc });
    } catch {
      // skip the entry, keep the page
    }
  }
  // Newest first; the log is append-only so file order is oldest-first.
  return out.reverse();
}

// ---------- 2. replicate-brief-*.md ----------

function briefs(memDir: string): ReplicateBrief[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(memDir).filter((f) => /^replicate-brief-.*\.md$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
  return files.map((file) => {
    const text = readText(path.join(memDir, file));
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file.replace(/\.md$/, "");
    const status =
      text.match(/^\s*[-*]*\s*\**status\**\s*[:—-]\s*\**\s*(.+)$/im)?.[1]?.replace(/\*+/g, "").trim() ?? null;
    return { file, title, status, awaiting: /awaiting/i.test(status ?? "") };
  });
}

// ---------- 3. runner health ----------

function openclawBin() {
  // launchd and Next's dev server don't always inherit a PATH with Homebrew on it.
  for (const p of ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]) if (fs.existsSync(p)) return p;
  return "openclaw";
}

type RawRun = {
  status?: string;
  runAtIso?: string;
  tsIso?: string;
  durationMs?: number;
  model?: string;
  error?: string;
  summary?: string;
};

function cronRuns(): ResearchTab["cron"] {
  try {
    const out = execFileSync(openclawBin(), ["cron", "runs", MRR_RESEARCH_JOB, "--limit", "3"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const start = out.indexOf("{");
    if (start < 0) return { jobId: MRR_RESEARCH_JOB, runs: [], error: "no JSON from `openclaw cron runs`" };
    const entries = (JSON.parse(out.slice(start)).entries ?? []) as RawRun[];
    return {
      jobId: MRR_RESEARCH_JOB,
      runs: entries.map((e) => ({
        at: e.runAtIso ?? e.tsIso ?? null,
        status: e.status ?? "?",
        durationMs: typeof e.durationMs === "number" ? e.durationMs : null,
        model: e.model ?? null,
        error: e.error ?? null,
        // The summary opens with progress chatter; the verdict line is the bold one.
        summary: clip(e.summary?.match(/\*\*([^*]{8,})\*\*/)?.[1] ?? e.summary ?? null, 220),
      })),
      error: null,
    };
  } catch (e) {
    return { jobId: MRR_RESEARCH_JOB, runs: [], error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

function researchEvals(memDir: string): ResearchEval[] {
  const rows: ResearchEval[] = [];
  for (const line of readText(path.join(memDir, "sprint-eval-log.jsonl")).split("\n")) {
    if (!line.includes("research")) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r?.sprint_type !== "string" || !r.sprint_type.startsWith("research")) continue;
      rows.push({
        ts: String(r.ts ?? ""),
        score: typeof r.score === "number" ? r.score : NaN,
        sprintType: r.sprint_type,
        goal: clip(r.goal ?? r.shipped ?? null, 160),
      });
    } catch {
      // skip
    }
  }
  return rows.slice(-5).reverse();
}

// ---------- 4. mrr-research-queue.md OPEN threads ----------

function backlog(memDir: string): BacklogThread[] {
  const open = section(readText(path.join(memDir, "mrr-research-queue.md")), /OPEN threads/i);
  const out: BacklogThread[] = [];
  for (const m of open.matchAll(/^###\s+(?:Thread\s+)?#?(\d+[A-Z-]*)\.\s*(.+)$/gim)) {
    const raw = m[2].trim();
    // "### 36-ORIGINAL." headings are context copies of a rewritten thread, not threads.
    if (/ORIGINAL/.test(m[1]) || /✅|\bCLOSED\b|\bRESOLVED\b|SUPERSEDED/.test(raw)) continue;
    // Headings carry their tags as "(HIGH, cheap, from #249)", "(ACTION, HIGH, …)",
    // or a trailing "— HIGHEST PRIORITY". Cut the title at the first of those.
    const tagAt = raw.search(/\s\((?:ACTION|HIGH|MEDIUM|LOW|SCHEDULED|STANDING|ESCALATION|cheap|from)\b|\s+—\s+/i);
    const title = (tagAt > 0 ? raw.slice(0, tagAt) : raw).trim();
    const tags = tagAt > 0 ? raw.slice(tagAt) : "";
    const level = tags.match(/\b(HIGHEST|HIGH|MEDIUM|LOW)\b/i)?.[1];
    const kind = tags.match(/\b(SCHEDULED|STANDING RULE|ESCALATION|WATCH)\b/i)?.[1];
    out.push({ id: m[1], title, priority: (level ?? kind)?.toUpperCase() ?? null });
  }
  return out;
}

export function researchTab(clawdRoot: string): ResearchTab {
  const memDir = path.join(clawdRoot, "memory");
  const logText = readText(path.join(memDir, "agentic-replication-log.md"));
  let replication: ResearchTab["replication"];
  try {
    replication = { queue: replicationQueue(logText), entries: replicationEntries(logText), error: null };
  } catch (e) {
    replication = { queue: [], entries: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (!logText) replication.error = "memory/agentic-replication-log.md not found";

  return {
    replication,
    briefs: briefs(memDir),
    cron: cronRuns(),
    evals: researchEvals(memDir),
    backlog: backlog(memDir),
  };
}
