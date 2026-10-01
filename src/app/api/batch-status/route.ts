import { NextResponse } from "next/server";
import { db } from "@/db";
import { batches } from "@/db/schema";
import { eq, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Lightweight status probe for background analysis: the upload modal polls
// this until the batch flips from "validated" to "analyzed".
export async function GET(req: Request) {
  const key = (new URL(req.url).searchParams.get("code") ?? "").trim();
  if (!key) return NextResponse.json({ error: "missing ?code=" }, { status: 400 });
  const idNum = Number(key);
  const where = Number.isFinite(idNum) && idNum > 0
    ? or(eq(batches.batchCode, key), eq(batches.id, idNum))
    : eq(batches.batchCode, key);
  const [b] = await db
    .select({ id: batches.id, batchCode: batches.batchCode, status: batches.status, componentCount: batches.componentCount })
    .from(batches)
    .where(where);
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(b);
}
