import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { refuseUnlessLocal } from "@/lib/local-gate";

export const dynamic = "force-dynamic";

// Thumbnail for an outbox draft's image_path. Serves only image files under the workspace or OpenClaw media dir.
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export async function GET(req: Request) {
  const refused = refuseUnlessLocal(req, { write: false });
  if (refused) return refused;
  const { ROOT } = await import("@/lib/data");
  const ALLOWED = [ROOT, path.join(os.homedir(), ".openclaw/media")].map((d) => path.resolve(d) + path.sep);
  const p = new URL(req.url).searchParams.get("path") || "";
  const abs = path.resolve(p.replace(/^~(?=\/)/, os.homedir()));
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
  const type = TYPES[path.extname(real).toLowerCase()];
  if (!type || !ALLOWED.some((d) => real.startsWith(d))) return new NextResponse("not allowed", { status: 403 });
  return new NextResponse(new Uint8Array(fs.readFileSync(real)), { headers: { "content-type": type, "cache-control": "private, max-age=300" } });
}
