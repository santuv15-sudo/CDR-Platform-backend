function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  jwtSecret: () => required("JWT_SECRET"),
  gcsBucket: () => process.env.GCS_BUCKET ?? "",
  gcpProject: () => process.env.GCP_PROJECT_ID ?? "",
  cookieSecure: () => process.env.COOKIE_SECURE === "true",
  cookieSameSite: () => process.env.COOKIE_SAME_SITE ?? "lax",
  corsOrigins: () =>
    (process.env.API_CORS_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};
