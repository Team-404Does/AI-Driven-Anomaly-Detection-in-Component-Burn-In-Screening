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
  // run in the background: long analyses outrun hosting proxy timeouts
  // (Render kills requests around ~100 s) — the client polls batch status
  void runPipeline(batchId)
    .then((result) => console.log(`[analyze] batch ${batchId} done:`, result))
    .catch((e) => console.error(`[analyze] batch ${batchId} failed`, e));
  return NextResponse.json({ ok: true, batchId, analyzing: true });
}
