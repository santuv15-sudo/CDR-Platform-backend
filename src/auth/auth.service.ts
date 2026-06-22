import { BadRequestException, Injectable } from "@nestjs/common";
import { authenticateUser, clearSessionCookie, sessionCookie, type CurrentUser } from "../lib/auth";

@Injectable()
export class AuthService {
  async login(body: { username?: string; email?: string; password?: string }) {
    // Login is username-based; accept legacy `email` field as an alias for robustness.
    const username = (body.username ?? body.email)?.trim();
    const password = body.password ?? "";
    if (!username || !password) throw new BadRequestException("Username and password are required");
    const { accessToken } = await authenticateUser(username, password);
    return { accessToken, cookie: sessionCookie(accessToken) };
  }

  logoutCookie() {
    return clearSessionCookie();
  }

  me(user: CurrentUser) {
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      staff_id: user.staffId,
      allowed_branches: user.allowedBranches,
      is_all_branches: user.isAllBranches,
      page_access: user.pageAccess,
    };
  }
}
