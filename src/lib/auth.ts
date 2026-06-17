import bcrypt from "bcryptjs";
import { db } from "./db";
import { env } from "./env";
import { signAccessToken, verifyAccessToken } from "./tokens";

const ALL_ACCESS_ROLES = new Set(["superadmin", "executive", "viewer"]);
const COOKIE_NAME = "csi_token";

export type RequestLike = {
  headers?: Headers | Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
};

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  staffId: number | null;
  allowedBranches: number[];
  isAllBranches: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function header(req: RequestLike, name: string): string {
  const headers = req.headers;
  if (headers && typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? "";
  }
  const fromExpress = req.get?.(name);
  if (fromExpress) return fromExpress;
  const raw = (headers as Record<string, string | string[] | undefined> | undefined)?.[name.toLowerCase()];
  return Array.isArray(raw) ? raw.join(";") : raw ?? "";
}

function bearer(req: RequestLike): string {
  const h = header(req, "authorization");
  const [scheme, token] = h.split(" ");
  if (scheme === "Bearer" && token) return token;
  const cookie = header(req, "cookie");
  const match = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  const cookieToken = match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : "";
  if (!cookieToken) throw new AuthError("Missing session token");
  return cookieToken;
}

interface AppUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  staff_id: number | null;
  branches_managed: number[] | null;
  active: boolean;
}

async function loadUser(sub: string): Promise<AppUserRow> {
  const rows = await db()`
    SELECT id, email, name, role, staff_id, branches_managed, active
    FROM app_users
    WHERE id = ${sub}::uuid
    LIMIT 1
  `;
  const user = rows[0] as AppUserRow | undefined;
  if (!user || !user.active) {
    throw new AuthError("No active user for this session", 403);
  }
  return user;
}

/** Verify JWT and load the caller's profile + branch scope. */
export async function getCurrentUser(req: RequestLike): Promise<CurrentUser> {
  let sub: string;
  try {
    sub = await verifyAccessToken(bearer(req));
  } catch (e) {
    throw new AuthError(`Invalid token: ${(e as Error).message}`);
  }

  const profile = await loadUser(sub);

  if (ALL_ACCESS_ROLES.has(profile.role)) {
    const branches = await db()`SELECT id FROM branches`;
    return {
      id: sub,
      name: profile.name,
      role: profile.role,
      staffId: profile.staff_id,
      allowedBranches: branches.map((b) => b.id as number),
      isAllBranches: true,
    };
  }

  if (profile.role === "district_manager") {
    return {
      id: sub,
      name: profile.name,
      role: profile.role,
      staffId: profile.staff_id,
      allowedBranches: profile.branches_managed ?? [],
      isAllBranches: false,
    };
  }

  let branchIds: number[] = [];
  if (profile.staff_id) {
    const staffRows = await db()`
      SELECT branch_id FROM staff WHERE id = ${profile.staff_id} LIMIT 1
    `;
    const branchId = staffRows[0]?.branch_id as number | null | undefined;
    if (branchId) branchIds = [branchId];
  }

  return {
    id: sub,
    name: profile.name,
    role: profile.role,
    staffId: profile.staff_id,
    allowedBranches: branchIds,
    isAllBranches: false,
  };
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<{ id: string; accessToken: string }> {
  const rows = await db()`
    SELECT id, password_hash
    FROM app_users
    WHERE email = ${email}
      AND active = true
    LIMIT 1
  `;
  const user = rows[0] as { id: string; password_hash: string } | undefined;
  if (!user?.password_hash) {
    throw new AuthError("Invalid email or password");
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new AuthError("Invalid email or password");

  await db()`UPDATE app_users SET last_login_at = now(), updated_at = now() WHERE id = ${user.id}::uuid`;
  const accessToken = await signAccessToken(user.id);
  return { id: user.id, accessToken };
}

export function requireRoles(user: CurrentUser, ...roles: string[]): void {
  if (!roles.includes(user.role)) throw new AuthError("Insufficient permissions", 403);
}

/** branches arg to pass to RPCs: null = all branches (no scoping). */
export function scopeBranches(user: CurrentUser): number[] | null {
  return user.isAllBranches ? null : user.allowedBranches;
}

export function sessionCookie(token: string): string {
  const secure = env.cookieSecure() ? "; Secure" : "";
  const sameSite = env.cookieSameSite();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=86400${secure}`;
}

export function clearSessionCookie(): string {
  const secure = env.cookieSecure() ? "; Secure" : "";
  const sameSite = env.cookieSameSite();
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`;
}
