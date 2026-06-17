import { Controller, Get, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUserParam } from "../auth/current-user.decorator";
import type { CurrentUser } from "../lib/auth";
import { ExportsService } from "./exports.service";

@Controller("api/exports")
@UseGuards(AuthGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  private csv(res: Response, filename: string, data: string) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(data);
  }

  @Get("cdr")
  async cdr(@CurrentUserParam() user: CurrentUser, @Req() req: Request, @Res() res: Response) {
    return this.csv(res, "cdr_powerbi_calls.csv", await this.exportsService.cdr(user, req));
  }

  @Get("branch-health")
  async branchHealth(@CurrentUserParam() user: CurrentUser, @Req() req: Request, @Res() res: Response) {
    return this.csv(res, "cdr_powerbi_branch_health.csv", await this.exportsService.branchHealth(user, req));
  }

  @Get("agent-coaching")
  async agentCoaching(@CurrentUserParam() user: CurrentUser, @Req() req: Request, @Res() res: Response) {
    return this.csv(res, "cdr_powerbi_agent_coaching.csv", await this.exportsService.agentCoaching(user, req));
  }
}
