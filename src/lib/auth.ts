// Credential authentication and signed session cookies for CRIP.
//
// Deliberately dependency-free: passwords are hashed with Node's built-in scrypt and
// sessions are HMAC-SHA256 signed cookies, so there is no external auth service that
// can be unreachable during a demo. This requires the Node.js runtime (already
// required by the Postgres driver), which is also why no edge middleware is used.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { ROLES, type Role } from "@/lib/roles";

export const SESSION_COOKIE = "crip_session";
export const SESSION_TTL_S = 12 * 60 * 60;

export interface SessionUser {
  uid: number;
  name: string;
  email: string;
  role: Role;
}

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;
const DEV_FALLBACK_SECRET = "crip-development-only-insecure-session-secret";

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.trim().length >= 16) return s.trim();
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[auth] SESSION_SECRET is unset or too short - falling back to the public development default. Set SESSION_SECRET in the Railway service variables.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  try {
    const expected = Buffer.from(keyB64, "base64url");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64url"), expected.length, SCRYPT);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------- session tokens ----------

function sign(body: string): string {
  return createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

export function createSessionToken(user: SessionUser): string {
  const payload = {
    uid: user.uid,
    name: user.name,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p?.exp !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    if (!p.uid || !p.name || !p.email) return null;
    return {
      uid: p.uid,
      name: p.name,
      email: p.email,
      role: p.role === ROLES.EXPERT ? ROLES.EXPERT : ROLES.WORKER,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function isExpert(user: SessionUser | null | undefined): boolean {
  return user?.role === ROLES.EXPERT;
}

/** Page guard: sends anonymous visitors to the login screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/**
 * API guard. Returns either the session user, or a ready-to-return error response:
 * 401 when anonymous, 403 when the role is not permitted.
 */
export async function requireApiRole(
  allow: Role[] = [ROLES.EXPERT, ROLES.WORKER],
): Promise<{ user: SessionUser; res: null } | { user: null; res: NextResponse }> {
  const user = await getSession();
  if (!user) {
    return { user: null, res: NextResponse.json({ error: "authentication required" }, { status: 401 }) };
  }
  if (!allow.includes(user.role)) {
    return {
      user: null,
      res: NextResponse.json(
        {
          error: "insufficient role",
          required: allow,
          role: user.role,
          hint: "This action requires the industrial-expert role.",
        },
        { status: 403 },
      ),
    };
  }
  return { user, res: null };
}
