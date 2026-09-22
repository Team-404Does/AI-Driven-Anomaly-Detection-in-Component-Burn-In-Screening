// Credential sign-in. Issues the signed session cookie and records the attempt.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_S, verifyPassword } from "@/lib/auth";
import { asRole } from "@/lib/roles";
import { ensureDemoUsers } from "@/lib/demo-users";

export const dynamic = "force-dynamic";

// In-process brute-force throttle. Adequate for a single-instance prototype; it is
// not distributed and resets on redeploy (see README).
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 5 * 60_000;
const attempts = new Map<string, { count: number; first: number }>();

function isThrottled(key: string): boolean {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (isThrottled(email)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  // Self-healing: guarantees the seeded accounts exist with a usable password hash,
  // including on a database created before the password column existed. Without this,
  // a fresh database would have no account able to sign in at all.
  await ensureDemoUsers();

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordFailure(email);
    await db.insert(auditLog).values({
      userId: null,
      userName: email,
      action: "LOGIN_FAILED",
      objectType: "user",
      objectId: email,
      detail: { reason: user ? "wrong password" : "no such account" },
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const role = asRole(user.role);
  attempts.delete(email);
  await db.insert(auditLog).values({
    userId: user.id,
    userName: user.name,
    action: "LOGIN",
    objectType: "user",
    objectId: user.email,
    detail: { role },
  });

  const res = NextResponse.json({ ok: true, user: { name: user.name, email: user.email, role } });
  res.cookies.set(SESSION_COOKIE, createSessionToken({ uid: user.id, name: user.name, email: user.email, role }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
