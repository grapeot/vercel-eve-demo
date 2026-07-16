import { isIpAllowed, verifyAccessCookie } from "./access";
import {
  ACCESS_COOKIE_NAME,
  clientIpFromHeaders,
  resolveAccessConfig,
} from "./config";
import { AccessSessionRepository } from "../storage/repositories";
import { getDatabaseClient } from "../storage/server";

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export async function authenticateOwnerRequest(
  request: Pick<Request, "headers">,
): Promise<{ accessSessionId: string; clientIp: string } | null> {
  try {
    const config = resolveAccessConfig();
    const clientIp = clientIpFromHeaders(request.headers);
    const token = readCookie(request.headers.get("cookie"), ACCESS_COOKIE_NAME);
    if (!clientIp || !token || !isIpAllowed(clientIp, config.allowedCidrs)) return null;
    const payload = verifyAccessCookie({ token, signingKey: config.cookieSigningKey });
    if (!payload) return null;
    const active = await new AccessSessionRepository(
      getDatabaseClient(),
    ).findActive(payload.sessionId);
    return active ? { accessSessionId: payload.sessionId, clientIp } : null;
  } catch {
    return null;
  }
}
