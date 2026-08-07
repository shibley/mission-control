import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/source";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getDashboardData());
}
