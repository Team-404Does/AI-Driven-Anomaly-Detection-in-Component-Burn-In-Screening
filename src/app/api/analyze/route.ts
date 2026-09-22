import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/ml/pipeline";
import { db } from "@/db";
import { batches } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireApiRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const guard = await requireApiRole();
  if (!guard.user) return guard.res;
  const body = await req.json().catch(() => ({}));
  let batchId = body.batchId as number | undefined;
  if (!batchId) {
    const [b] = await db.select().from(batches).orderBy(desc(batches.createdAt)).limit(1);
    batchId = b?.id;
  }
  if (!batchId) return NextResponse.json({ error: "no batch" }, { status: 404 });
  const result = await runPipeline(batchId, { userId: guard.user.uid, userName: guard.user.name });
  return NextResponse.json({ ok: true, batchId, ...result });
}
