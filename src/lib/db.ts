import postgres from "postgres";
import { env } from "./env";

let _sql: ReturnType<typeof postgres> | null = null;

/** Postgres client via Supabase transaction pooler (prepare: false for PgBouncer). */
export function db() {
  if (!_sql) {
    _sql = postgres(env.databaseUrl(), { prepare: false, max: 10 });
  }
  return _sql;
}
