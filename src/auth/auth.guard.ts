import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { getCurrentUser } from "../lib/auth";

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    req.user = await getCurrentUser(req);
    return true;
  }
}
