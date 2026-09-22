import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/seed";
import { requireApiRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A force reseed truncates the reference dataset: expert role only.
  const guard = await requireApiRole([ROLES.EXPERT]);
  if (!guard.user) return guard.res;
  const body = await req.json().catch(() => ({}));
  const result = await ensureSeeded(!!body.force);
  return NextResponse.json(result);
}
export async function GET() {
  const result = await ensureSeeded(false);
  return NextResponse.json(result);
}
