import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { CurrentUser } from "../lib/auth";
import {
  metricsAgents,
  metricsBranches,
  metricsCoaching,
  metricsCoverage,
  metricsDaily,
  metricsFilterOptions,
  metricsHealth,
  metricsHourly,
  metricsKpis,
  metricsManager,
  metricsQuality,
  metricsRecords,
  metricsRecovery,
} from "../lib/metrics";
import { parseFilters } from "../lib/query";

@Injectable()
export class MetricsService {
  async kpis(user: CurrentUser, req: Request) {
    const data = await metricsKpis(user, parseFilters(req));
    return data[0] ?? null;
  }

  daily(user: CurrentUser, req: Request) {
    return metricsDaily(user, parseFilters(req));
  }

  hourly(user: CurrentUser, req: Request) {
    return metricsHourly(user, parseFilters(req));
  }

  branches(user: CurrentUser, req: Request) {
    return metricsBranches(user, parseFilters(req));
  }

  manager(user: CurrentUser, req: Request) {
    return metricsManager(user, parseFilters(req));
  }

  agents(user: CurrentUser, req: Request) {
    return metricsAgents(user, parseFilters(req));
  }

  async agentDetail(user: CurrentUser, req: Request, id: string) {
    const filters = parseFilters(req);
    filters.staff_id = Number(id);
    filters.page_size = 25;
    const [agents, records] = await Promise.all([
      metricsAgents(user, filters),
      metricsRecords(user, filters),
    ]);
    return { agent: agents[0] ?? null, records: records.rows };
  }

  records(user: CurrentUser, req: Request) {
    return metricsRecords(user, parseFilters(req));
  }

  recovery(user: CurrentUser, req: Request) {
    return metricsRecovery(user, parseFilters(req));
  }

  health(user: CurrentUser, req: Request) {
    return metricsHealth(user, parseFilters(req));
  }

  coaching(user: CurrentUser, req: Request) {
    return metricsCoaching(user, parseFilters(req));
  }

  coverage(user: CurrentUser, req: Request) {
    return metricsCoverage(user, parseFilters(req));
  }

  quality(user: CurrentUser, req: Request) {
    return metricsQuality(user, parseFilters(req));
  }

  filters(user: CurrentUser) {
    return metricsFilterOptions(user);
  }
}
