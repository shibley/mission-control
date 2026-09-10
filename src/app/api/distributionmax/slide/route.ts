import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/**
 * Serves generated slides off this Mac's disk. Only exists locally — on Vercel
 * there is no filesystem and the page reads the Blob mirror instead.
 *
 * `f` arrives from the client, so it is resolved and then checked to still sit
 * under distributionmax/out/. Everything else in that repo — .env with the
 * Gemini key, the config, the pack — is one `..` away otherwise.
 */
export async function GET(req: Request) {
  if (process.env.VERCEL) return new NextResponse("no filesystem on Vercel", { status: 404 });

  const { ROOT } = await import("@/lib/data");
  const { dmxRoot } = await import("@/lib/distributionmax");
  const outRoot = path.resolve(dmxRoot(ROOT), "out");

  const rel = new URL(req.url).searchParams.get("f") ?? "";
  const abs = path.resolve(path.dirname(outRoot), rel);
  if (abs !== outRoot && !abs.startsWith(outRoot + path.sep)) {
    return new NextResponse("outside out/", { status: 403 });
  }

  const type = TYPES[path.extname(abs).toLowerCase()];
  if (!type) return new NextResponse("not an image", { status: 403 });

  let body: Buffer;
  try {
    body = fs.readFileSync(abs);
  } catch {
    return new NextResponse("not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": type, "cache-control": "private, max-age=60" },
  });
}
