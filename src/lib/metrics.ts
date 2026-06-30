import type { CurrentUser } from "./auth";
import { db } from "./db";
import { cdrWhere, offset, type MetricFilters } from "./query";

export async function metricsKpis(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      count(*)::bigint AS total_calls,
      count(*) FILTER (WHERE direction = 'Inbound')::bigint AS inbound,
      count(*) FILTER (WHERE direction = 'Outbound')::bigint AS outbound,
      count(*) FILTER (WHERE direction = 'Inbound' AND answered)::bigint AS inbound_answered,
      count(*) FILTER (WHERE direction = 'Inbound' AND NOT answered)::bigint AS inbound_missed,
      count(*) FILTER (WHERE direction = 'Outbound' AND answered)::bigint AS outbound_answered,
      count(*) FILTER (WHERE direction = 'Outbound' AND NOT answered)::bigint AS outbound_no_response,
      round(COALESCE(count(*) FILTER (WHERE answered)::numeric / NULLIF(count(*), 0) * 100, 0), 2) AS answer_rate,
      round(COALESCE(count(*) FILTER (WHERE direction = 'Inbound' AND answered)::numeric / NULLIF(count(*) FILTER (WHERE direction = 'Inbound'), 0) * 100, 0), 2) AS inbound_connect_rate,
      round(COALESCE(count(*) FILTER (WHERE direction = 'Outbound' AND answered)::numeric / NULLIF(count(*) FILTER (WHERE direction = 'Outbound'), 0) * 100, 0), 2) AS outbound_connect_rate,
      round(COALESCE(avg(duration_secs), 0)::numeric, 1) AS avg_duration_secs,
      COALESCE(sum(duration_secs), 0)::bigint AS total_duration_secs
    FROM cdr_records c
    WHERE ${where}
  `;
}

export async function metricsDaily(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      to_char(c.call_date, 'YYYY-MM-DD') AS call_date,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE direction = 'Inbound')::bigint AS inbound,
      count(*) FILTER (WHERE direction = 'Outbound')::bigint AS outbound,
      count(*) FILTER (WHERE answered)::bigint AS answered,
      count(*) FILTER (WHERE direction = 'Inbound' AND answered)::bigint AS inbound_answered,
      count(*) FILTER (WHERE direction = 'Inbound' AND NOT answered)::bigint AS inbound_missed,
      count(*) FILTER (WHERE direction = 'Outbound' AND answered)::bigint AS outbound_answered,
      count(*) FILTER (WHERE direction = 'Outbound' AND NOT answered)::bigint AS outbound_no_response,
      round(COALESCE(avg(duration_secs), 0)::numeric, 1) AS avg_duration_secs
    FROM cdr_records c
    WHERE ${where}
    GROUP BY c.call_date
    ORDER BY c.call_date
  `;
}

export async function metricsHourly(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      c.hour,
      count(*)::bigint AS calls,
      count(*) FILTER (WHERE c.direction = 'Inbound')::bigint AS inbound,
      count(*) FILTER (WHERE c.direction = 'Inbound' AND NOT c.answered)::bigint AS inbound_missed,
      count(DISTINCT c.staff_id) FILTER (WHERE c.staff_id IS NOT NULL)::bigint AS active_staff
    FROM cdr_records c
    WHERE ${where}
      AND c.hour IS NOT NULL
    GROUP BY c.hour
    ORDER BY c.hour
  `;
}

export async function metricsDurationDistribution(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      to_char(c.call_date, 'YYYY-MM-DD') AS call_date,
      count(*) FILTER (WHERE c.duration_secs < 1200)::int AS under_20,
      count(*) FILTER (WHERE c.duration_secs >= 1200 AND c.duration_secs < 1800)::int AS m20_30,
      count(*) FILTER (WHERE c.duration_secs >= 1800 AND c.duration_secs < 2400)::int AS m30_40,
      count(*) FILTER (WHERE c.duration_secs >= 2400 AND c.duration_secs < 3000)::int AS m40_50,
      count(*) FILTER (WHERE c.duration_secs >= 3000)::int AS m50_plus
    FROM cdr_records c
    WHERE ${where} AND c.answered = true AND c.call_date IS NOT NULL
    GROUP BY c.call_date
    ORDER BY c.call_date
  `;
}

export async function metricsHeatmap(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT to_char(c.call_date, 'YYYY-MM-DD') AS call_date, c.hour, count(*)::int AS calls
    FROM cdr_records c
    WHERE ${where} AND c.call_date IS NOT NULL AND c.hour IS NOT NULL
    GROUP BY c.call_date, c.hour
    ORDER BY c.call_date, c.hour
  `;
}

export async function metricsAnalytics(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  // Analytics shows both directions side by side, so ignore any direction filter.
  const where = cdrWhere(sql, user, { ...f, direction: null });

  const [inOut, outOut, lin, lout, topIn, topOut] = await Promise.all([
    sql`SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE answered)::int AS answered,
          count(*) FILTER (WHERE answered AND call_result ILIKE '%extension%')::int AS after_disposition,
          count(*) FILTER (WHERE NOT answered)::int AS unanswered
        FROM cdr_records c WHERE ${where} AND c.direction = 'Inbound'::call_direction`,
    sql`SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE answered)::int AS answered,
          count(*) FILTER (WHERE NOT answered)::int AS no_response
        FROM cdr_records c WHERE ${where} AND c.direction = 'Outbound'::call_direction`,
    sql`SELECT c.duration_secs::int AS duration_secs, c.calling_tn AS external_tn,
          to_char(c.call_date, 'YYYY-MM-DD') AS call_date, s.name AS staff_name
        FROM cdr_records c LEFT JOIN staff s ON s.id = c.staff_id
        WHERE ${where} AND c.direction = 'Inbound'::call_direction
        ORDER BY c.duration_secs DESC NULLS LAST LIMIT 1`,
    sql`SELECT c.duration_secs::int AS duration_secs, c.called_tn AS external_tn,
          to_char(c.call_date, 'YYYY-MM-DD') AS call_date, s.name AS staff_name
        FROM cdr_records c LEFT JOIN staff s ON s.id = c.staff_id
        WHERE ${where} AND c.direction = 'Outbound'::call_direction
        ORDER BY c.duration_secs DESC NULLS LAST LIMIT 1`,
    sql`SELECT c.calling_tn AS tn, count(*)::int AS calls, sum(c.duration_secs)::bigint AS total_dur,
          round(avg(c.duration_secs))::int AS avg_dur, max(c.duration_secs)::int AS max_dur,
          string_agg(DISTINCT b.name, ', ') AS branches
        FROM cdr_records c LEFT JOIN branches b ON b.id = c.branch_id
        WHERE ${where} AND c.direction = 'Inbound'::call_direction AND c.calling_tn IS NOT NULL AND c.calling_tn <> ''
        GROUP BY c.calling_tn ORDER BY total_dur DESC NULLS LAST LIMIT 10`,
    sql`SELECT c.called_tn AS tn, count(*)::int AS calls, sum(c.duration_secs)::bigint AS total_dur,
          round(avg(c.duration_secs))::int AS avg_dur, max(c.duration_secs)::int AS max_dur,
          string_agg(DISTINCT b.name, ', ') AS branches
        FROM cdr_records c LEFT JOIN branches b ON b.id = c.branch_id
        WHERE ${where} AND c.direction = 'Outbound'::call_direction AND c.called_tn IS NOT NULL AND c.called_tn <> ''
        GROUP BY c.called_tn ORDER BY total_dur DESC NULLS LAST LIMIT 10`,
  ]);

  return {
    outcomes: { inbound: inOut[0] ?? null, outbound: outOut[0] ?? null },
    longest_inbound: lin[0] ?? null,
    longest_outbound: lout[0] ?? null,
    top_duration_inbound: topIn,
    top_duration_outbound: topOut,
  };
}

export async function metricsBranches(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      b.id AS branch_id,
      b.name AS branch_name,
      dm.name AS dm_name,
      count(c.*)::bigint AS total,
      count(c.*) FILTER (WHERE c.direction = 'Inbound')::bigint AS inbound,
      count(c.*) FILTER (WHERE c.direction = 'Outbound')::bigint AS outbound,
      count(c.*) FILTER (WHERE c.direction = 'Inbound' AND c.answered)::bigint AS inbound_answered,
      count(c.*) FILTER (WHERE c.direction = 'Inbound' AND NOT c.answered)::bigint AS inbound_missed,
      count(c.*) FILTER (WHERE c.direction = 'Outbound' AND c.answered)::bigint AS outbound_answered,
      count(c.*) FILTER (WHERE c.direction = 'Outbound' AND NOT c.answered)::bigint AS outbound_no_response,
      round(COALESCE(count(c.*) FILTER (WHERE c.direction = 'Inbound' AND c.answered)::numeric / NULLIF(count(c.*) FILTER (WHERE c.direction = 'Inbound'), 0) * 100, 0), 2) AS inbound_connect_rate,
      round(COALESCE(count(c.*) FILTER (WHERE c.direction = 'Outbound' AND c.answered)::numeric / NULLIF(count(c.*) FILTER (WHERE c.direction = 'Outbound'), 0) * 100, 0), 2) AS outbound_connect_rate,
      round(COALESCE(avg(c.duration_secs), 0)::numeric, 1) AS avg_duration_secs
    FROM cdr_records c
    LEFT JOIN branches b ON b.id = c.branch_id
    LEFT JOIN district_managers dm ON dm.id = c.dm_id
    WHERE ${where}
    GROUP BY b.id, b.name, dm.name
    ORDER BY total DESC, b.name
  `;
}

export async function metricsAgents(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  return sql`
    SELECT
      s.id AS staff_id,
      COALESCE(s.name, c.raw_user_name, 'Unmapped') AS staff_name,
      b.id AS branch_id,
      b.name AS branch_name,
      dm.id AS dm_id,
      dm.name AS dm_name,
      count(*)::bigint AS total_calls,
      count(*) FILTER (WHERE c.direction = 'Inbound')::bigint AS inbound,
      count(*) FILTER (WHERE c.direction = 'Outbound')::bigint AS outbound,
      count(*) FILTER (WHERE c.direction = 'Inbound' AND c.answered)::bigint AS inbound_answered,
      count(*) FILTER (WHERE c.direction = 'Inbound' AND NOT c.answered)::bigint AS inbound_missed,
      count(*) FILTER (WHERE c.direction = 'Outbound' AND c.answered)::bigint AS outbound_answered,
      count(*) FILTER (WHERE c.direction = 'Outbound' AND NOT c.answered)::bigint AS outbound_no_response,
      round(COALESCE(count(*) FILTER (WHERE c.direction = 'Inbound' AND c.answered)::numeric / NULLIF(count(*) FILTER (WHERE c.direction = 'Inbound'), 0) * 100, 0), 2) AS inbound_connect_rate,
      round(COALESCE(count(*) FILTER (WHERE c.direction = 'Outbound' AND c.answered)::numeric / NULLIF(count(*) FILTER (WHERE c.direction = 'Outbound'), 0) * 100, 0), 2) AS outbound_connect_rate,
      round(COALESCE(avg(c.duration_secs), 0)::numeric, 1) AS avg_duration_secs,
      COALESCE(sum(c.duration_secs), 0)::bigint AS total_duration_secs
    FROM cdr_records c
    LEFT JOIN staff s ON s.id = c.staff_id
    LEFT JOIN branches b ON b.id = c.branch_id
    LEFT JOIN district_managers dm ON dm.id = c.dm_id
    WHERE ${where}
    GROUP BY s.id, s.name, c.raw_user_name, b.id, b.name, dm.id, dm.name
    ORDER BY total_calls DESC, staff_name
  `;
}

export async function metricsManager(user: CurrentUser, f: MetricFilters) {
  const [kpis, agents, branches, hourly] = await Promise.all([
    metricsKpis(user, f),
    metricsAgents(user, f),
    metricsBranches(user, f),
    metricsHourly(user, f),
  ]);
  return { kpis: kpis[0] ?? null, agents: agents.slice(0, 20), branches, hourly };
}

export async function metricsRecords(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  const limit = f.page_size;
  const off = offset(f);
  const rows = await sql`
    SELECT
      c.id, to_char(c.call_date, 'YYYY-MM-DD') AS call_date, c.call_time, c.hour, c.direction, c.answered, c.duration_secs,
      c.calling_tn, c.called_tn, c.caller_id_name, c.raw_user_name,
      c.local_call_id, c.remote_call_id, c.source_file,
      s.id AS staff_id, COALESCE(s.name, c.raw_user_name) AS staff_name,
      b.id AS branch_id, b.name AS branch_name,
      dm.id AS dm_id, dm.name AS dm_name
    FROM cdr_records c
    LEFT JOIN staff s ON s.id = c.staff_id
    LEFT JOIN branches b ON b.id = c.branch_id
    LEFT JOIN district_managers dm ON dm.id = c.dm_id
    WHERE ${where}
    ORDER BY c.call_date DESC NULLS LAST, c.call_time DESC NULLS LAST, c.id DESC
    LIMIT ${limit}
    OFFSET ${off}
  `;
  const total = await sql`SELECT count(*)::bigint AS total FROM cdr_records c WHERE ${where}`;
  return { rows, total: Number(total[0]?.total ?? 0), page: f.page, page_size: f.page_size };
}

export async function metricsRecovery(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  const callers = await sql`
    WITH scoped AS (
      SELECT c.*, b.name AS branch_name, s.name AS staff_name
      FROM cdr_records c
      LEFT JOIN branches b ON b.id = c.branch_id
      LEFT JOIN staff s ON s.id = c.staff_id
      WHERE ${where}
    ),
    missed AS (
      SELECT *,
        regexp_replace(COALESCE(calling_tn, ''), '\\D', '', 'g') AS caller_phone,
        (to_char(call_date, 'YYYYMMDD') || regexp_replace(COALESCE(call_time, '00:00:00'), '\\D', '', 'g'))::numeric AS time_value
      FROM scoped
      WHERE direction = 'Inbound' AND NOT answered
    ),
    grouped AS (
      SELECT
        caller_phone,
        count(*)::bigint AS attempts,
        max(call_date) AS last_missed_date,
        max(call_time) AS last_missed_time,
        max(time_value) AS last_time_value,
        (array_agg(branch_name ORDER BY time_value DESC))[1] AS branch_name,
        (array_agg(staff_name ORDER BY time_value DESC))[1] AS staff_name
      FROM missed
      WHERE caller_phone <> ''
      GROUP BY caller_phone
    )
    SELECT
      g.caller_phone,
      g.attempts,
      g.last_missed_date,
      g.last_missed_time,
      g.branch_name,
      g.staff_name,
      EXISTS (
        SELECT 1 FROM scoped o
        WHERE o.direction = 'Outbound'
          AND regexp_replace(COALESCE(o.called_tn, ''), '\\D', '', 'g') = g.caller_phone
          AND (to_char(o.call_date, 'YYYYMMDD') || regexp_replace(COALESCE(o.call_time, '00:00:00'), '\\D', '', 'g'))::numeric > g.last_time_value
      ) AS callback_found
    FROM grouped g
    ORDER BY g.attempts DESC, g.last_missed_date DESC
    LIMIT 100
  `;
  const byHour = await sql`
    SELECT hour, count(*)::bigint AS missed
    FROM cdr_records c
    WHERE ${where} AND direction = 'Inbound' AND NOT answered AND hour IS NOT NULL
    GROUP BY hour ORDER BY hour
  `;
  const byBranch = await sql`
    SELECT b.name AS branch_name, count(*)::bigint AS missed
    FROM cdr_records c
    LEFT JOIN branches b ON b.id = c.branch_id
    WHERE ${where} AND direction = 'Inbound' AND NOT answered
    GROUP BY b.name ORDER BY missed DESC LIMIT 12
  `;
  return {
    kpis: {
      missed_inbound: byHour.reduce((sum, row) => sum + Number(row.missed ?? 0), 0),
      unique_missed_callers: callers.length,
      repeat_missed_callers: callers.filter((c) => Number(c.attempts) > 1).length,
      callbacks_found: callers.filter((c) => c.callback_found).length,
    },
    callers,
    by_hour: byHour,
    by_branch: byBranch,
  };
}

export async function metricsHealth(user: CurrentUser, f: MetricFilters) {
  const rows = await metricsBranches(user, f);
  const maxMiss = Math.max(1, ...rows.map((r) => Number(r.inbound_missed ?? 0)));
  const branches = rows.map((r) => {
    const inboundRate = Number(r.inbound_connect_rate ?? 0);
    const outboundRate = Number(r.outbound_connect_rate ?? 0);
    const burdenScore = 100 - (Number(r.inbound_missed ?? 0) / maxMiss) * 100;
    const peakMissRate = inboundRate ? Math.max(0, 100 - inboundRate) : 0;
    const score = Math.max(0, Math.min(100, inboundRate * 0.4 + outboundRate * 0.2 + burdenScore * 0.25 + (100 - peakMissRate) * 0.15));
    return {
      ...r,
      peak_miss_rate: Number(peakMissRate.toFixed(2)),
      health_score: Number(score.toFixed(2)),
      status: score >= 80 ? "Healthy" : score >= 60 ? "Watch" : "Critical",
    };
  }).sort((a, b) => b.health_score - a.health_score);
  return {
    branches,
    best: branches[0] ?? null,
    worst: branches[branches.length - 1] ?? null,
    critical: branches.filter((b) => b.status === "Critical").length,
  };
}

export async function metricsCoaching(user: CurrentUser, f: MetricFilters) {
  const agents = (await metricsAgents(user, f)).map((a) => {
    const inbound = Number(a.inbound ?? 0);
    const outbound = Number(a.outbound ?? 0);
    const total = Number(a.total_calls ?? 0);
    const inboundMissed = Number(a.inbound_missed ?? 0);
    const outboundNoResponse = Number(a.outbound_no_response ?? 0);
    const inboundRate = Number(a.inbound_connect_rate ?? 0);
    const outboundRate = Number(a.outbound_connect_rate ?? 0);
    const avgDur = Number(a.avg_duration_secs ?? 0);
    const reasons: string[] = [];
    if (inbound >= 10 && inboundMissed >= 10) reasons.push("High missed inbound");
    if (inbound >= 10 && inboundRate < 40) reasons.push("Low inbound connect");
    if (outbound >= 10 && outboundRate < 60) reasons.push("Low outbound connect");
    if (total < 5) reasons.push("Low activity");
    if (total >= 5 && (avgDur < 15 || avgDur > 180)) reasons.push("Talk-time outlier");
    const priority = inboundMissed * 2 + outboundNoResponse + (inbound >= 10 ? Math.max(0, 60 - inboundRate) : 0)
      + (outbound >= 10 ? Math.max(0, 70 - outboundRate) / 2 : 0) + reasons.length * 8;
    return { ...a, reasons, priority: Number(priority.toFixed(2)) };
  }).sort((a, b) => b.priority - a.priority || Number((b as any).total_calls) - Number((a as any).total_calls));
  return {
    agents,
    attention: agents.filter((a) => a.reasons.length).length,
    high_missed: agents.filter((a) => a.reasons.includes("High missed inbound")).length,
    low_outbound: agents.filter((a) => a.reasons.includes("Low outbound connect")).length,
    talk_outliers: agents.filter((a) => a.reasons.includes("Talk-time outlier")).length,
  };
}

export async function metricsCoverage(user: CurrentUser, f: MetricFilters) {
  const hourly = await metricsHourly(user, f);
  const busiest = hourly.slice().sort((a, b) => Number(b.calls) - Number(a.calls))[0] ?? null;
  const worstMiss = hourly.slice().sort((a, b) => Number(b.inbound_missed) - Number(a.inbound_missed))[0] ?? null;
  const peakRate = hourly
    .map((h) => ({ ...h, miss_rate: Number(h.inbound) ? Number(h.inbound_missed) / Number(h.inbound) * 100 : 0 }))
    .filter((h) => Number((h as any).inbound) >= 5)
    .sort((a, b) => b.miss_rate - a.miss_rate)[0] ?? null;
  const sql = db();
  const where = cdrWhere(sql, user, f);
  const heat = await sql`
    SELECT call_date, hour, count(*)::bigint AS total,
      count(*) FILTER (WHERE direction = 'Inbound' AND NOT answered)::bigint AS missed
    FROM cdr_records c
    WHERE ${where} AND call_date IS NOT NULL AND hour IS NOT NULL
    GROUP BY call_date, hour
    ORDER BY call_date, hour
  `;
  const branchPressure = await sql`
    SELECT b.name AS branch_name, c.hour, count(*)::bigint AS total,
      count(*) FILTER (WHERE c.direction = 'Inbound' AND NOT c.answered)::bigint AS missed
    FROM cdr_records c
    LEFT JOIN branches b ON b.id = c.branch_id
    WHERE ${where} AND c.hour IS NOT NULL
    GROUP BY b.name, c.hour
    ORDER BY missed DESC, total DESC
    LIMIT 12
  `;
  return { hours: hourly, busiest, worst_missed_hour: worstMiss, peak_rate: peakRate, heat, branch_pressure: branchPressure };
}

export async function metricsQuality(user: CurrentUser, f: MetricFilters) {
  const sql = db();
  const where = cdrWhere(sql, user, f);
  const issueScope = cdrWhere(sql, user, f, "cx");
  const totals = await sql`
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE staff_id IS NOT NULL AND branch_id IS NOT NULL)::bigint AS mapped,
      min(call_date) AS start_date,
      max(call_date) AS end_date
    FROM cdr_records c
    WHERE ${where}
  `;
  const unmapped = await sql`
    SELECT COALESCE(raw_user_name, '(blank)') AS raw_user, count(*)::bigint AS calls
    FROM cdr_records c
    WHERE ${where} AND (staff_id IS NULL OR branch_id IS NULL)
    GROUP BY COALESCE(raw_user_name, '(blank)')
    ORDER BY calls DESC
    LIMIT 50
  `;
  const issues = await sql`
    SELECT i.issue_type, i.severity, i.raw_user, i.message, count(*)::bigint AS count
    FROM ingestion_issues i
    WHERE EXISTS (
      SELECT 1
      FROM cdr_records cx
      WHERE cx.batch_id = i.batch_id AND ${issueScope}
    )
    GROUP BY issue_type, severity, raw_user, message
    ORDER BY count DESC
    LIMIT 150
  `;
  const duplicateRows = await sql`
    SELECT count(*)::bigint AS duplicate_count
    FROM ingestion_issues i
    WHERE issue_type = 'duplicate_cdr_row'
      AND EXISTS (
        SELECT 1
        FROM cdr_records cx
        WHERE cx.batch_id = i.batch_id AND ${issueScope}
      )
  `;
  const total = Number(totals[0]?.total ?? 0);
  const mapped = Number(totals[0]?.mapped ?? 0);
  return {
    total_rows: total,
    mapping_coverage: total ? Number((mapped / total * 100).toFixed(2)) : 0,
    date_range: { start: totals[0]?.start_date ?? null, end: totals[0]?.end_date ?? null },
    unmapped,
    duplicate_count: Number(duplicateRows[0]?.duplicate_count ?? 0),
    issues,
  };
}

export async function metricsFilterOptions(user: CurrentUser) {
  const sql = db();
  const scope = cdrWhere(sql, user, {
    branch_id: null, dm_id: null, staff_id: null, start: null, end: null, date: null,
    direction: null, outcome: null, search: null, page: 1, page_size: 50,
  });
  const [dates, dms, branches, staff] = await Promise.all([
    sql`SELECT DISTINCT to_char(call_date, 'YYYY-MM-DD') AS call_date FROM cdr_records c WHERE ${scope} AND call_date IS NOT NULL ORDER BY 1 DESC`,
    sql`SELECT DISTINCT dm.id, dm.name FROM cdr_records c JOIN district_managers dm ON dm.id = c.dm_id WHERE ${scope} ORDER BY dm.name`,
    sql`SELECT DISTINCT b.id, b.name, b.dm_id FROM cdr_records c JOIN branches b ON b.id = c.branch_id WHERE ${scope} ORDER BY b.id`,
    sql`SELECT DISTINCT s.id, s.name, s.branch_id, s.dm_id FROM cdr_records c JOIN staff s ON s.id = c.staff_id WHERE ${scope} ORDER BY s.name`,
  ]);
  return { dates, dms, branches, staff };
}
