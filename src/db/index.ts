import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let pool = globalForDb.__arenaNextJsPostgresqlPool;

if (!pool) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    console.warn("[db] DATABASE_URL is not set — database calls will fail until it is configured.");
  }
  pool = new Pool({
    connectionString: databaseUrl ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    max: 10,
  });
}


if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
