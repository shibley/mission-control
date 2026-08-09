import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Local-only dashboard: reads the real memory files in ~/clawd directly.
// Resolved from cwd rather than from this file's path because Next bundles the
// module elsewhere; CLAWD_ROOT is what the launchd pusher sets, since a cron-ish
// job cannot be trusted to start in the project directory.
export const ROOT = process.env.CLAWD_ROOT || path.resolve(process.cwd(), "../..");

const mem = (...p: string[]) => path.join(ROOT, "memory", ...p);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export type Priority = {
  id: string;
  title: string;
  owner: "shib" | "billybob";
  status: "open" | "doing" | "blocked" | "done";
  why?: string;
  note?: string;
  updatedAt?: string;
};

export type PrioritiesFile = {
  lastUpdated: string;
  // Order of this array IS the ranking. Advisory today: sprints do not read it yet.
  authoritative: boolean;
  items: Priority[];
};

const PRIORITIES_FILE = mem("priorities.json");

export function readPriorities(): PrioritiesFile {
  return readJson<PrioritiesFile>(PRIORITIES_FILE, {
    lastUpdated: new Date().toISOString(),
    authoritative: false,
    items: [],
  });
}

export function writePriorities(file: PrioritiesFile) {
  const next = { ...file, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(PRIORITIES_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

// ---------- Idea backlog ----------

// Deliberately a separate file from priorities.json: the ranked list is for
// decisions and in-flight work, and a pile of unvetted ideas would swamp it.
export type Idea = {
  id: string;
  title: string;
  kind: string;
  /** candidate | candidate-unverified | parked | rejected */
  verdict: string;
  source?: string;
  evidence?: string;
  risk?: string;
  nextStep?: string;
};

export type IdeasFile = { lastUpdated: string; note?: string; items: Idea[] };

export function readIdeas(): IdeasFile {
  return readJson<IdeasFile>(mem("app-ideas.json"), {
    lastUpdated: new Date().toISOString(),
    items: [],
  });
}

// ---------- MRR / funnel, from the production-watchdog day files ----------

type WatchdogStripe = Record<string, number | null>;
type WatchdogFile = {
  generatedAt?: string;
  properties?: Record<
    string,
    { status?: string; metrics?: Record<string, number>; errors?: string[]; stripe?: WatchdogStripe }
  >;
  analytics?: {
    sites?: Record<
      string,
      {
        se24Human?: number;
        pv24Human?: number;
        se7Human?: number;
        pv7Human?: number;
        se7Bot?: number;
        topReferrers?: { host: string; sessions: number }[];
      }
    >;
    totalEvents?: number;
    firstEventAt?: string;
  };
};

function watchdogDays(n: number): { day: string; data: WatchdogFile }[] {
  const dir = mem("watchdog");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return files
    .slice(-n)
    .map((f) => ({ day: f.replace(/\.json$/, ""), data: readJson<WatchdogFile>(path.join(dir, f), {}) }));
}

export function moneyPanel() {
  const days = watchdogDays(14);
  const latest = days[days.length - 1];
  if (!latest) return null;

  const props = Object.entries(latest.data.properties ?? {}).map(([name, p]) => {
    const s = p.stripe ?? {};
    const a = latest.data.analytics?.sites?.[name];
    const se7 = a?.se7Human ?? 0;
    const starts7 = Number(s.realStarts7d ?? 0);
    return {
      name,
      status: p.status ?? "?",
      mrr: Number(s.mrrCents ?? 0) / 100,
      mrrDelta24h: Number(s.mrrDelta24hCents ?? 0) / 100,
      activeSubs: Number(s.activeSubs ?? 0),
      sessions24h: a?.se24Human ?? 0,
      sessions7d: se7,
      botShare7d: se7 + (a?.se7Bot ?? 0) > 0 ? (a?.se7Bot ?? 0) / (se7 + (a?.se7Bot ?? 0)) : 0,
      checkoutStarts7d: starts7,
      paid7d: Number(s.realPaid7d ?? 0),
      startRate7d: se7 > 0 ? starts7 / se7 : 0,
      topReferrers: a?.topReferrers?.slice(0, 4) ?? [],
      errors: p.errors ?? [],
    };
  });

  // MRR trend across the retained day files, for a sparkline.
  const trend = days.map(({ day, data }) => ({
    day,
    mrr:
      Object.values(data.properties ?? {}).reduce(
        (sum, p) => sum + Number(p.stripe?.mrrCents ?? 0),
        0
      ) / 100,
  }));

  return {
    generatedAt: latest.data.generatedAt ?? null,
    totalMrr: props.reduce((s, p) => s + p.mrr, 0),
    totalEvents: latest.data.analytics?.totalEvents ?? 0,
    properties: props.sort((a, b) => b.mrr - a.mrr),
    trend,
  };
}

// ---------- Sprints ----------

type Rotation = {
  rotationIndex?: number;
  rotationVersion?: string;
  lastUpdated?: string;
  workTypes?: string[];
  sprintInstructions?: Record<string, string>;
};

type CodingState = {
  lastUpdated?: string;
  lastBuild?: string;
  nextBuild?: string;
  rotationOrder?: string[];
  lastTask?: string;
};

export type EvalRow = {
  ts: string;
  sprint_type: string;
  commit?: string;
  score: number;
  shipped?: string;
  why?: string;
  next_focus?: string;
};

export function sprintPanel() {
  const rot = readJson<Rotation>(mem("work-rotation.json"), {});
  const coding = readJson<CodingState>(mem("coding-sprint-state.json"), {});

  const rows: EvalRow[] = readText(mem("sprint-eval-log.jsonl"))
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as EvalRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is EvalRow => !!r && typeof r.score === "number");

  const recent = rows.slice(-20).reverse();

  // Mean score per sprint type over the last 30 fires — surfaces score ceilings.
  const byType = new Map<string, number[]>();
  for (const r of rows.slice(-60)) {
    if (!byType.has(r.sprint_type)) byType.set(r.sprint_type, []);
    byType.get(r.sprint_type)!.push(r.score);
  }
  const typeScores = [...byType.entries()]
    .map(([type, scores]) => ({
      type,
      fires: scores.length,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => a.mean - b.mean);

  // ⛔ shows up in ordinary instruction text (exclusion rules, caps), so only a
  // stop-word near it counts as an actual pause guard.
  const paused = Object.entries(rot.sprintInstructions ?? {})
    .filter(([, v]) => /(⛔|🚫)[^\n]{0,60}\b(PAUSED?|STOP|DO NOT RUN|DO NOT SELECT)\b/i.test(String(v)))
    .map(([k]) => k);

  return {
    work: {
      lastUpdated: rot.lastUpdated ?? null,
      index: rot.rotationIndex ?? 0,
      slots: rot.workTypes ?? [],
      paused,
    },
    coding: {
      lastUpdated: coding.lastUpdated ?? null,
      last: coding.lastBuild ?? null,
      next: coding.nextBuild ?? null,
      order: coding.rotationOrder ?? [],
    },
    recent,
    typeScores,
  };
}

// ---------- Shib-blocked items, parsed from blockers.md ----------

export function blockersPanel() {
  const text = readText(mem("blockers.md"));
  const out: { section: string; title: string; body: string }[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const b = line.match(/^-\s+\*\*(.+?)\*\*\s*(.*)$/);
    if (b) out.push({ section, title: b[1].replace(/\.$/, ""), body: b[2] });
  }
  return out;
}

// ---------- Repo health ----------

const REPOS = [
  "aisotools",
  "ratedwithai",
  "replacedbai",
  "apistatuscheck",
  "mymcptools",
  "debt-payoff-app",
  "keyseo",
  "usersrated",
  "ship-job-board",
  "landscapingai",
  "wholesmb",
];

function git(repo: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", path.join(ROOT, repo), ...args], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function reposPanel() {
  return REPOS.filter((r) => fs.existsSync(path.join(ROOT, r, ".git"))).map((repo) => {
    const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const ahead = git(repo, ["rev-list", "--count", "@{u}..HEAD"]);
    const dirty = git(repo, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
    const lastCommit = git(repo, ["log", "-1", "--format=%cI|%s"]);
    const [when, subject] = lastCommit.split("|");
    return {
      repo,
      branch,
      unpushed: Number(ahead || 0),
      dirtyFiles: dirty,
      lastCommitAt: when || null,
      lastCommitSubject: subject || null,
    };
  });
}

// ---------- Research queue ----------

export function researchPanel() {
  const text = readText(mem("mrr-research-queue.md"));
  // Everything under "## Log" is finished verdicts, not queue.
  const queue = text.split(/^##\s+Log\s*$/im)[0];

  const threads = [...queue.matchAll(/^###\s+(?:Thread\s+)?#?(\d+[A-Z-]*)\.\s*(.+)$/gim)].map((m) => {
    const title = m[2].trim();
    const done = /✅\s*DONE|RESOLVED|NO-GO/i.test(title);
    return {
      id: m[1],
      title: title.replace(/\s+—\s+(✅|⚠️).*$/, "").trim(),
      verdict: done ? (/(NO-GO)/i.test(title) ? "NO-GO" : "DONE") : null,
      high: /HIGH PRIORITY/i.test(title),
      blocked: /RE-SCOPE|DO NOT RUN/i.test(title),
    };
  });

  const open = threads.filter((t) => !t.verdict);
  return {
    // Open threads first (high priority at the top), then the most recent verdicts.
    threads: [
      ...open.sort((a, b) => Number(b.high) - Number(a.high)),
      ...threads.filter((t) => t.verdict).slice(0, 4),
    ].slice(0, 14),
    openCount: open.length,
  };
}

export function snapshot() {
  return {
    at: new Date().toISOString(),
    root: ROOT,
    money: moneyPanel(),
    sprints: sprintPanel(),
    blockers: blockersPanel(),
    repos: reposPanel(),
    research: researchPanel(),
    priorities: readPriorities(),
    ideas: readIdeas(),
  };
}

export type Snapshot = ReturnType<typeof snapshot>;
