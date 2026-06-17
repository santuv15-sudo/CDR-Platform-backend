-- 001_init.sql — core schema (matches gettao / CSI CDR platform)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('superadmin','executive','district_manager','staff','viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE call_direction AS ENUM ('Inbound','Outbound');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE ingest_status AS ENUM ('pending','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS district_managers (
  id          serial PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id          integer PRIMARY KEY,
  name        text NOT NULL,
  dm_id       integer REFERENCES district_managers(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  username    text,
  extension   text,
  branch_id   integer REFERENCES branches(id),
  dm_id       integer REFERENCES district_managers(id),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_extension_idx ON staff(extension);
CREATE INDEX IF NOT EXISTS staff_branch_idx ON staff(branch_id);

CREATE TABLE IF NOT EXISTS profiles (
  id                uuid PRIMARY KEY,
  email             text,
  name              text NOT NULL,
  role              user_role NOT NULL DEFAULT 'viewer',
  staff_id          integer REFERENCES staff(id),
  branches_managed  integer[] NOT NULL DEFAULT '{}',
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name       text NOT NULL,
  file_type       text NOT NULL,
  gcs_path        text NOT NULL,
  status          ingest_status NOT NULL DEFAULT 'pending',
  rows_total      integer NOT NULL DEFAULT 0,
  rows_inserted   integer NOT NULL DEFAULT 0,
  rows_duplicate  integer NOT NULL DEFAULT 0,
  rows_unmapped   integer NOT NULL DEFAULT 0,
  error           text,
  uploaded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdr_records (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_date     date,
  call_time     text,
  direction     call_direction,
  call_result   text,
  answered      boolean NOT NULL DEFAULT false,
  duration_secs integer NOT NULL DEFAULT 0,
  hour          integer,
  calling_tn    text,
  called_tn     text,
  staff_id      integer REFERENCES staff(id),
  branch_id     integer REFERENCES branches(id),
  dm_id         integer REFERENCES district_managers(id),
  source_file   text,
  batch_id      uuid REFERENCES ingestion_batches(id),
  dedup_key     text NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cdr_dedup_key_uq ON cdr_records(dedup_key);
CREATE INDEX IF NOT EXISTS cdr_call_date_idx ON cdr_records(call_date);
CREATE INDEX IF NOT EXISTS cdr_branch_date_idx ON cdr_records(branch_id, call_date);
CREATE INDEX IF NOT EXISTS cdr_staff_date_idx ON cdr_records(staff_id, call_date);
CREATE INDEX IF NOT EXISTS cdr_direction_idx ON cdr_records(direction);
