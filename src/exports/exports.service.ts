import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { toCsv } from "../common/csv";
import type { CurrentUser } from "../lib/auth";
import { metricsCoaching, metricsHealth, metricsRecords } from "../lib/metrics";
import { parseFilters } from "../lib/query";

@Injectable()
export class ExportsService {
  async cdr(user: CurrentUser, req: Request) {
    const filters = parseFilters(req);
    filters.page_size = 10000;
    const data = await metricsRecords(user, filters);
    return toCsv(data.rows as Record<string, unknown>[]);
  }

  async branchHealth(user: CurrentUser, req: Request) {
    const data = await metricsHealth(user, parseFilters(req));
    return toCsv(data.branches as Record<string, unknown>[]);
  }

  async agentCoaching(user: CurrentUser, req: Request) {
    const data = await metricsCoaching(user, parseFilters(req));
    return toCsv(data.agents as Record<string, unknown>[]);
  }
}
