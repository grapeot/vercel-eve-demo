export const ACCESS_COOKIE_NAME = "research_workbench_access";

export interface AccessConfig {
  allowedCidrs: string[];
  challengeSecret: string;
  cookieSigningKey: string;
  cookieTtlSeconds: number;
}

export function resolveAccessConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccessConfig {
  const required = [
    "ACCESS_ALLOWED_CIDRS",
    "ACCESS_CHALLENGE_SECRET",
    "ACCESS_COOKIE_SIGNING_KEY",
  ] as const;
  for (const name of required) {
    if (!env[name]) throw new Error(`${name} is required`);
  }
  for (const name of ["ACCESS_CHALLENGE_SECRET", "ACCESS_COOKIE_SIGNING_KEY"] as const) {
    if (Buffer.from(env[name]!, "base64url").length !== 32) {
      throw new Error(`${name} must contain exactly 32 bytes`);
    }
  }
  const ttl = Number(env.ACCESS_COOKIE_TTL_SECONDS ?? 8 * 60 * 60);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7 * 24 * 60 * 60) {
    throw new Error("ACCESS_COOKIE_TTL_SECONDS must be between 60 and 604800");
  }
  return {
    allowedCidrs: env.ACCESS_ALLOWED_CIDRS!.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    challengeSecret: env.ACCESS_CHALLENGE_SECRET!,
    cookieSigningKey: env.ACCESS_COOKIE_SIGNING_KEY!,
    cookieTtlSeconds: ttl,
  };
}

export function clientIpFromHeaders(
  headers: Pick<Headers, "get">,
  isVercel = process.env.VERCEL === "1",
): string | null {
  if (isVercel) {
    return headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || null;
  }
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "127.0.0.1"
  );
}
