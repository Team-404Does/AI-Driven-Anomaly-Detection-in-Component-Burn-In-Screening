import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/ml/pipeline";
import { db } from "@/db";
import { batches } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let batchId = body.batchId as number | undefined;
  if (!batchId) {
    const [b] = await db.select().from(batches).orderBy(desc(batches.createdAt)).limit(1);
    batchId = b?.id;
  }
  if (!batchId) return NextResponse.json({ error: "no batch" }, { status: 404 });
  const result = await runPipeline(batchId);
  return NextResponse.json({ ok: true, batchId, ...result });
}
