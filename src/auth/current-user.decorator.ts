import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { CurrentUser } from "../lib/auth";

export const CurrentUserParam = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as CurrentUser;
});
