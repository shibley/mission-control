import { NextResponse } from "next/server";

// Write routes that touch this Mac's files (freesite.db outbox) must never run on the Vercel copy, and on the Mac
// only for a same-origin request that is either from localhost or came through the basic-auth middleware
// (MC_PASSWORD set — the ngrok tunnel case). Returns a response to send back when the request is refused, else null.
export function refuseUnlessLocal(req: Request, { write = true } = {}): NextResponse | null {
  if (process.env.VERCEL) return NextResponse.json({ error: "read-only on Vercel: approve from the Mac dashboard" }, { status: 404 });
  const host = req.headers.get("host") || "";
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!isLocalHost && !process.env.MC_PASSWORD) return NextResponse.json({ error: "remote access needs MC_PASSWORD basic auth" }, { status: 403 });
  if (write) {
    // CSRF: a browser POST always carries Origin; it must be this same host.
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== host) return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
  }
  return null;
}
