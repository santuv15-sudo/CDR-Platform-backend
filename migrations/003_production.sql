-- 003_production.sql — production auth, imports, mapping metadata, and CDR detail

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  password_hash     text NOT NULL,
  name              text NOT NULL,
  role              user_role NOT NULL DEFAULT 'viewer',
  staff_id          integer REFERENCES staff(id),
  branches_managed  integer[] NOT NULL DEFAULT '{}',
  active            boolean NOT NULL DEFAULT true,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users(role);
CREATE INDEX IF NOT EXISTS app_users_staff_idx ON app_users(staff_id);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS fax text,
  ADD COLUMN IF NOT EXISTS opened text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS cdr_aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE ingestion_batches
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cdr',
  ADD COLUMN IF NOT EXISTS rows_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_system integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS ingestion_issues (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id    uuid REFERENCES ingestion_batches(id) ON DELETE CASCADE,
  issue_type  text NOT NULL,
  severity    text NOT NULL DEFAULT 'medium',
  row_number  integer,
  raw_user    text,
  message     text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingestion_issues_batch_idx ON ingestion_issues(batch_id);
CREATE INDEX IF NOT EXISTS ingestion_issues_type_idx ON ingestion_issues(issue_type);

ALTER TABLE cdr_records
  ADD COLUMN IF NOT EXISTS raw_user_name text,
  ADD COLUMN IF NOT EXISTS caller_id_name text,
  ADD COLUMN IF NOT EXISTS local_call_id text,
  ADD COLUMN IF NOT EXISTS remote_call_id text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS cdr_active_date_idx ON cdr_records(call_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cdr_batch_idx ON cdr_records(batch_id);
CREATE INDEX IF NOT EXISTS cdr_phone_idx ON cdr_records(calling_tn, called_tn);
