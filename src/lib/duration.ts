export function parseDurationToSecs(val: unknown): number {
  const s = String(val ?? "").trim();
  if (!s) return 0;
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => parseInt(p, 10) || 0);
    while (parts.length < 3) parts.unshift(0);
    const [h, m, sec] = parts.slice(-3);
    return h * 3600 + m * 60 + sec;
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
