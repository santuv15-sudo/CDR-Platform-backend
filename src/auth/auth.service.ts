import { BadRequestException, Injectable } from "@nestjs/common";
import { authenticateUser, clearSessionCookie, sessionCookie, type CurrentUser } from "../lib/auth";

@Injectable()
export class AuthService {
  async login(body: { email?: string; password?: string }) {
    const email = body.email?.trim();
    const password = body.password ?? "";
    if (!email || !password) throw new BadRequestException("Email and password are required");
    const { accessToken } = await authenticateUser(email, password);
    return { accessToken, cookie: sessionCookie(accessToken) };
  }

  logoutCookie() {
    return clearSessionCookie();
  }

  me(user: CurrentUser) {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      staff_id: user.staffId,
      allowed_branches: user.allowedBranches,
      is_all_branches: user.isAllBranches,
    };
  }
}
