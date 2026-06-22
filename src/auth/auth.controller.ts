import { Body, Controller, Get, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import type { CurrentUser } from "../lib/auth";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { CurrentUserParam } from "./current-user.decorator";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("api/auth/login")
  async login(@Body() body: { username?: string; email?: string; password?: string }, @Res({ passthrough: true }) res: Response) {
    const { accessToken, cookie } = await this.auth.login(body);
    res.setHeader("Set-Cookie", cookie);
    return { ok: true, access_token: accessToken };
  }

  @Post("api/auth/logout")
  logout(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Set-Cookie", this.auth.logoutCookie());
    return { ok: true };
  }

  @Get("api/me")
  @UseGuards(AuthGuard)
  me(@CurrentUserParam() user: CurrentUser) {
    return this.auth.me(user);
  }
}
