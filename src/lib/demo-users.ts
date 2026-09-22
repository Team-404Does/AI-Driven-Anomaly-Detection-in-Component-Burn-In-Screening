// Self-healing demo account provisioning.
//
// Kept in its own module rather than lib/seed.ts because the sign-in route needs it and
// must not pull the analysis pipeline (and the synthetic generator) into its import graph.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

let ready: Promise<{ accounts: number; repaired: number }> | null = null;

/**
 * Ensure the demo accounts exist with a usable password hash and the correct role.
 *
 * Called on boot and on every sign-in attempt, because the users table can predate the
 * password column: without this the seeded rows would exist but nobody could sign in.
 * Existing rows are matched by email, so a live database is repaired rather than
 * duplicated, and a hash is only rewritten when it is missing - or when a force reseed
 * explicitly asks for it.
 */
export async function ensureDemoUsers(force = false): Promise<{ accounts: number; repaired: number }> {
  if (force) ready = null;
  if (!ready) {
    ready = (async () => {
      const existing = await db.select().from(users);
      const byEmail = new Map(existing.map((u) => [u.email.trim().toLowerCase(), u]));
      let repaired = 0;
      for (const acc of DEMO_ACCOUNTS) {
        const cur = byEmail.get(acc.email.toLowerCase());
        if (!cur) {
          await db.insert(users).values({
            name: acc.name,
            email: acc.email,
            role: acc.role,
            passwordHash: hashPassword(acc.password),
          });
          repaired++;
          continue;
        }
        const needsHash = !cur.passwordHash;
        if (force || needsHash || cur.role !== acc.role || cur.name !== acc.name) {
          await db.update(users).set({
            name: acc.name,
            role: acc.role,
            passwordHash: force || needsHash ? hashPassword(acc.password) : cur.passwordHash,
          }).where(eq(users.id, cur.id));
          repaired++;
        }
      }
      return { accounts: DEMO_ACCOUNTS.length, repaired };
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
