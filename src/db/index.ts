import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let pool = globalForDb.__arenaNextJsPostgresqlPool;

if (!pool) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // Loud failure instead of a silent localhost fallback: on hosting platforms
    // (Vercel etc.) localhost has no Postgres, and a silent fallback turns every
    // page into an opaque 500. Local dev without a URL still gets a useful error.
    throw new Error(
      "[db] DATABASE_URL is not set. Add it in your hosting provider's environment " +
        "variables (Vercel: Project → Settings → Environment Variables), e.g. " +
        "postgresql://user:pass@host:5432/dbname?sslmode=require",
    );
  }

  const isLocal = /(?:localhost|127\.0\.0\.1)/.test(databaseUrl);
  pool = new Pool({
    connectionString: databaseUrl,
    // Hosted Postgres (Railway public URL, Supabase, Neon, ...) terminates TLS;
    // CA chains vary per provider, so verify=False is the pragmatic default.
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // Serverless platforms can instantiate many lambdas; keep the footprint small.
    max: Number(process.env.PGPOOL_MAX ?? 5),
    connectionTimeoutMillis: 10_000,
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
