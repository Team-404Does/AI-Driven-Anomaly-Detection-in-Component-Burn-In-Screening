import { NextResponse } from "next/server";
import { searchComponentCodes } from "@/lib/queries";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireApiRole();
  if (!guard.user) return guard.res;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  const rows = await searchComponentCodes(q);
  return NextResponse.json({ results: rows });
}
