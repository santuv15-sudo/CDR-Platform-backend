import type { CurrentUser } from "./auth";
import { db } from "./db";

export interface MetricFilters {
  branch_id: number | null;
  dm_id: number | null;
  staff_id: number | null;
  start: string | null;
  end: string | null;
  date: string | null;
  direction: string | null;
  outcome: string | null;
  search: string | null;
  page: number;
  page_size: number;
}

type Sql = ReturnType<typeof db>;
type Fragment = ReturnType<Sql>;

function intParam(url: URL, key: string): number | null {
  const value = url.searchParams.get(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type RequestUrlLike = {
  url?: string;
  originalUrl?: string;
  query?: Record<string, unknown>;
};

function requestUrl(req: Request | RequestUrlLike): URL {
  const raw = "originalUrl" in req && req.originalUrl ? req.originalUrl : req.url;
  if (raw?.startsWith("http://") || raw?.startsWith("https://")) return new URL(raw);
  const url = new URL(raw || "/", "http://localhost");
  const query = "query" in req ? req.query : undefined;
  if (query && !url.search) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, Array.isArray(value) ? String(value[0]) : String(value));
    }
  }
  return url;
}

export function parseFilters(req: Request | RequestUrlLike): MetricFilters {
  const url = requestUrl(req);
  return {
    branch_id: intParam(url, "branch_id"),
    dm_id: intParam(url, "dm_id"),
    staff_id: intParam(url, "staff_id"),
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    date: url.searchParams.get("date"),
    direction: url.searchParams.get("direction"),
    outcome: url.searchParams.get("outcome"),
    search: url.searchParams.get("search"),
    page: Math.max(1, intParam(url, "page") ?? 1),
    page_size: Math.min(200, Math.max(10, intParam(url, "page_size") ?? 50)),
  };
}

export function cdrWhere(sql: Sql, user: CurrentUser, f: MetricFilters, alias = "c"): Fragment {
  const a = sql.unsafe(alias);
  const conditions: Fragment[] = [sql`${a}.deleted_at IS NULL`];

  if (user.role === "staff") {
    if (user.staffId) conditions.push(sql`${a}.staff_id = ${user.staffId}`);
    else conditions.push(sql`FALSE`);
  } else if (!user.isAllBranches) {
    if (user.allowedBranches.length) conditions.push(sql`${a}.branch_id = ANY(${user.allowedBranches}::int[])`);
    else conditions.push(sql`FALSE`);
  }

  if (f.branch_id) conditions.push(sql`${a}.branch_id = ${f.branch_id}`);
  if (f.dm_id) conditions.push(sql`${a}.dm_id = ${f.dm_id}`);
  if (f.staff_id) conditions.push(sql`${a}.staff_id = ${f.staff_id}`);
  if (f.date) conditions.push(sql`${a}.call_date = ${f.date}::date`);
  if (f.start) conditions.push(sql`${a}.call_date >= ${f.start}::date`);
  if (f.end) conditions.push(sql`${a}.call_date <= ${f.end}::date`);
  if (f.direction && f.direction !== "all") conditions.push(sql`${a}.direction = ${f.direction}::call_direction`);
  if (f.outcome === "answered") conditions.push(sql`${a}.answered = true`);
  if (f.outcome === "missed") conditions.push(sql`${a}.direction = 'Inbound' AND ${a}.answered = false`);
  if (f.outcome === "noresp") conditions.push(sql`${a}.direction = 'Outbound' AND ${a}.answered = false`);
  if (f.search) {
    const like = `%${f.search}%`;
    conditions.push(sql`(
      ${a}.raw_user_name ILIKE ${like}
      OR ${a}.calling_tn ILIKE ${like}
      OR ${a}.called_tn ILIKE ${like}
      OR ${a}.caller_id_name ILIKE ${like}
      OR ${a}.local_call_id ILIKE ${like}
      OR ${a}.remote_call_id ILIKE ${like}
    )`);
  }

  return conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`, sql`TRUE`);
}

export function offset(f: MetricFilters): number {
  return (f.page - 1) * f.page_size;
}
