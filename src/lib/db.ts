import postgres from "postgres";
import { env } from "./env";

let _sql: ReturnType<typeof postgres> | null = null;

/** Postgres client via Supabase transaction pooler (prepare: false for PgBouncer).
 *  A larger pool + idle timeout keeps the bursty dashboard (several parallel metric
 *  queries per page) from exhausting connections and timing out. */
export function db() {
  if (!_sql) {
    _sql = postgres(env.databaseUrl(), {
      prepare: false,
      max: 20,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return _sql;
}
