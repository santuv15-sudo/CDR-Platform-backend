import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

const ISSUER = "csi-cdr";
const TTL = "24h";

function secret() {
  return new TextEncoder().encode(env.jwtSecret());
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
  const sub = String(payload.sub ?? "");
  if (!sub) throw new Error("Token missing subject");
  return sub;
}
