import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUserParam } from "../auth/current-user.decorator";
import type { CurrentUser } from "../lib/auth";
import { MetricsService } from "./metrics.service";

@Controller("api/metrics")
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("kpis")
  kpis(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.kpis(user, req);
  }

  @Get("daily")
  daily(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.daily(user, req);
  }

  @Get("hourly")
  hourly(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.hourly(user, req);
  }

  @Get("branches")
  branches(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.branches(user, req);
  }

  @Get("manager")
  manager(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.manager(user, req);
  }

  @Get("agents")
  agents(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.agents(user, req);
  }

  @Get("agents/:id")
  agentDetail(@CurrentUserParam() user: CurrentUser, @Req() req: Request, @Param("id") id: string) {
    return this.metrics.agentDetail(user, req, id);
  }

  @Get("cdr-records")
  records(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.records(user, req);
  }

  @Get("recovery")
  recovery(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.recovery(user, req);
  }

  @Get("health")
  health(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.health(user, req);
  }

  @Get("coaching")
  coaching(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.coaching(user, req);
  }

  @Get("coverage")
  coverage(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.coverage(user, req);
  }

  @Get("quality")
  quality(@CurrentUserParam() user: CurrentUser, @Req() req: Request) {
    return this.metrics.quality(user, req);
  }

  @Get("filters")
  filters(@CurrentUserParam() user: CurrentUser) {
    return this.metrics.filters(user);
  }
}
