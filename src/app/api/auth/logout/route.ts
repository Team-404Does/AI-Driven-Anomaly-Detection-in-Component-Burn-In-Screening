// Sign-out: records the event and clears the session cookie.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSession();
  if (user) {
    await db.insert(auditLog).values({
      userId: user.uid,
      userName: user.name,
      action: "LOGOUT",
      objectType: "user",
      objectId: user.email,
      detail: { role: user.role },
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
