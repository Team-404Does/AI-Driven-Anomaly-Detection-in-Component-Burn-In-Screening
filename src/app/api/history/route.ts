import { NextResponse } from "next/server";
import { getTestHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const part = url.searchParams.get("part")?.trim() || undefined;
  const lot = url.searchParams.get("lot")?.trim() || undefined;
  const days = Number(url.searchParams.get("days") ?? 90);
  if (!part && !lot) return NextResponse.json({ error: "provide ?part= or ?lot=" }, { status: 400 });
  try {
    const rows = await getTestHistory({ part, lot, days });
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "history query failed" }, { status: 500 });
  }
}
