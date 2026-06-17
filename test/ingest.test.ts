import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDurationToSecs } from "../src/lib/duration.ts";
import {
  CDR_HEADER_KEYWORDS,
  MAPPING_HEADER_KEYWORDS,
  detectColumns,
  isSystemUser,
  normalizeDateString,
  normalizeDirection,
  readRows,
} from "../src/lib/ingest-helpers.ts";

test("parseDurationToSecs handles HH:MM:SS and seconds", () => {
  assert.equal(parseDurationToSecs("00:01:30"), 90);
  assert.equal(parseDurationToSecs("1:00:00"), 3600);
  assert.equal(parseDurationToSecs("45"), 45);
  assert.equal(parseDurationToSecs(""), 0);
  assert.equal(parseDurationToSecs(null), 0);
});

test("detectColumns accepts production CDR header variants", () => {
  const cols = detectColumns(
    [
      "Agent Name",
      "Call Direction",
      "Answer Indicator",
      "Duration (HH:MM:SS)",
      "Start Date (MM/DD/YYYY)",
      "Start Time (HH:MM:SS) Central",
      "Calling TN",
      "Called TN",
      "Local Call ID",
    ],
    CDR_HEADER_KEYWORDS,
  );

  assert.equal(cols.user, "Agent Name");
  assert.equal(cols.direction, "Call Direction");
  assert.equal(cols.answered, "Answer Indicator");
  assert.equal(cols.duration, "Duration (HH:MM:SS)");
  assert.equal(cols.date, "Start Date (MM/DD/YYYY)");
  assert.equal(cols.time, "Start Time (HH:MM:SS) Central");
  assert.equal(cols.calling_tn, "Calling TN");
  assert.equal(cols.called_tn, "Called TN");
  assert.equal(cols.local_call_id, "Local Call ID");
});

test("detectColumns accepts mapping CSV header variants", () => {
  const cols = detectColumns(
    ["Branch #", "Branch Name", "District Manager", "Staff Name", "Extension", "CDR Name", "Opened"],
    MAPPING_HEADER_KEYWORDS,
  );

  assert.equal(cols.branch_id, "Branch #");
  assert.equal(cols.branch_name, "Branch Name");
  assert.equal(cols.dm_name, "District Manager");
  assert.equal(cols.staff_name, "Staff Name");
  assert.equal(cols.extension, "Extension");
  assert.equal(cols.cdr_name, "CDR Name");
  assert.equal(cols.opened, "Opened");
});

test("date and direction normalization handle common exports", () => {
  assert.equal(normalizeDateString("06/17/2026"), "2026-06-17");
  assert.equal(normalizeDateString("2026-06-17"), "2026-06-17");
  assert.equal(normalizeDateString("not a date"), null);
  assert.equal(normalizeDirection("Inbound Call"), "Inbound");
  assert.equal(normalizeDirection("outbound"), "Outbound");
  assert.equal(normalizeDirection("transfer"), null);
});

test("system-row detection skips hunt groups and attendants", () => {
  assert.equal(isSystemUser("Hunt Group 422"), true);
  assert.equal(isSystemUser("AA) Main Menu"), true);
  assert.equal(isSystemUser("Main Office"), true);
  assert.equal(isSystemUser("Jane Smith"), false);
});

test("readRows parses CSV with BOM-stripped headers", async () => {
  const csv = Buffer.from("\uFEFFUser Name,Direction,Duration\nJane Smith,Inbound,00:02:00\n");
  const rows = await readRows(csv, "calls.csv");

  assert.deepEqual(rows, [{ "User Name": "Jane Smith", Direction: "Inbound", Duration: "00:02:00" }]);
});
