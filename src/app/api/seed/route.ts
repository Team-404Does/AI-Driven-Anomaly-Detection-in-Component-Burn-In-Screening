import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await ensureSeeded(!!body.force);
  return NextResponse.json(result);
}
export async function GET() {
  const result = await ensureSeeded(false);
  return NextResponse.json(result);
}
