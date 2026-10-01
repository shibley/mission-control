import fs from "node:fs";
import path from "node:path";
import { ROOT } from "@/lib/data";

export const dynamic = "force-dynamic";

// Serves a research doc out of ~/clawd/memory as plain text, for the Research
// tab's doc links. Local only: Vercel has no memory/ directory, so there it 404s
// and the tab renders the path without a link.
export async function GET(req: Request) {
  const f = new URL(req.url).searchParams.get("f") ?? "";
  const name = path.basename(f);
  // Basename only, markdown only — this must never become a general file reader.
  if (!/^[\w.-]+\.md$/.test(name)) return new Response("bad name", { status: 400 });
  try {
    const body = fs.readFileSync(path.join(ROOT, "memory", name), "utf8");
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
