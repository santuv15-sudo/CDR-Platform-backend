-- 002_rpc.sql — aggregation functions for the backend API

CREATE OR REPLACE FUNCTION public.metrics_kpis(
  p_branches integer[] DEFAULT NULL,
  p_branch   integer   DEFAULT NULL,
  p_start    date      DEFAULT NULL,
  p_end      date      DEFAULT NULL
)
RETURNS TABLE (
  total_calls bigint, inbound bigint, outbound bigint,
  inbound_answered bigint, inbound_missed bigint,
  outbound_answered bigint, outbound_no_response bigint,
  answer_rate numeric, avg_duration_secs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH f AS (
    SELECT * FROM cdr_records c
    WHERE (p_branches IS NULL OR c.branch_id = ANY(p_branches))
      AND (p_branch IS NULL OR c.branch_id = p_branch)
      AND (p_start IS NULL OR c.call_date >= p_start)
      AND (p_end IS NULL OR c.call_date <= p_end)
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE direction='Inbound')::bigint,
    count(*) FILTER (WHERE direction='Outbound')::bigint,
    count(*) FILTER (WHERE direction='Inbound' AND answered)::bigint,
    count(*) FILTER (WHERE direction='Inbound' AND NOT answered)::bigint,
    count(*) FILTER (WHERE direction='Outbound' AND answered)::bigint,
    count(*) FILTER (WHERE direction='Outbound' AND NOT answered)::bigint,
    round(COALESCE(count(*) FILTER (WHERE answered)::numeric / NULLIF(count(*),0) * 100, 0), 2),
    round(COALESCE(avg(duration_secs), 0), 1)
  FROM f;
$$;

CREATE OR REPLACE FUNCTION public.metrics_daily(
  p_branches integer[] DEFAULT NULL,
  p_branch   integer   DEFAULT NULL,
  p_start    date      DEFAULT NULL,
  p_end      date      DEFAULT NULL
)
RETURNS TABLE (
  call_date date, total bigint, inbound bigint, outbound bigint,
  answered bigint, avg_duration_secs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.call_date, count(*)::bigint,
    count(*) FILTER (WHERE direction='Inbound')::bigint,
    count(*) FILTER (WHERE direction='Outbound')::bigint,
    count(*) FILTER (WHERE answered)::bigint,
    round(COALESCE(avg(duration_secs),0),1)
  FROM cdr_records c
  WHERE (p_branches IS NULL OR c.branch_id = ANY(p_branches))
    AND (p_branch IS NULL OR c.branch_id = p_branch)
    AND (p_start IS NULL OR c.call_date >= p_start)
    AND (p_end IS NULL OR c.call_date <= p_end)
  GROUP BY c.call_date ORDER BY c.call_date;
$$;

CREATE OR REPLACE FUNCTION public.metrics_hourly(
  p_branches integer[] DEFAULT NULL,
  p_branch   integer   DEFAULT NULL,
  p_start    date      DEFAULT NULL,
  p_end      date      DEFAULT NULL
)
RETURNS TABLE (hour integer, calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.hour, count(*)::bigint
  FROM cdr_records c
  WHERE c.hour IS NOT NULL
    AND (p_branches IS NULL OR c.branch_id = ANY(p_branches))
    AND (p_branch IS NULL OR c.branch_id = p_branch)
    AND (p_start IS NULL OR c.call_date >= p_start)
    AND (p_end IS NULL OR c.call_date <= p_end)
  GROUP BY c.hour ORDER BY c.hour;
$$;

CREATE OR REPLACE FUNCTION public.metrics_branches(
  p_branches integer[] DEFAULT NULL,
  p_branch   integer   DEFAULT NULL,
  p_start    date      DEFAULT NULL,
  p_end      date      DEFAULT NULL
)
RETURNS TABLE (
  branch_id integer, branch_name text, total bigint,
  inbound_connect_rate numeric, outbound_connect_rate numeric,
  avg_duration_secs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    b.id,
    b.name,
    count(c.*)::bigint,
    round(COALESCE(
      count(*) FILTER (WHERE c.direction='Inbound' AND c.answered)::numeric
      / NULLIF(count(*) FILTER (WHERE c.direction='Inbound'),0) * 100, 0), 2),
    round(COALESCE(
      count(*) FILTER (WHERE c.direction='Outbound' AND c.answered)::numeric
      / NULLIF(count(*) FILTER (WHERE c.direction='Outbound'),0) * 100, 0), 2),
    round(COALESCE(avg(c.duration_secs),0),1)
  FROM branches b
  LEFT JOIN cdr_records c ON c.branch_id = b.id
    AND (p_start IS NULL OR c.call_date >= p_start)
    AND (p_end IS NULL OR c.call_date <= p_end)
  WHERE (p_branches IS NULL OR b.id = ANY(p_branches))
    AND (p_branch IS NULL OR b.id = p_branch)
  GROUP BY b.id, b.name
  ORDER BY b.id;
$$;
