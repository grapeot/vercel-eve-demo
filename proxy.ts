import { NextRequest, NextResponse } from "next/server";

import { isIpAllowed, verifyAccessCookie } from "@/src/security/access";
import {
  ACCESS_COOKIE_NAME,
  clientIpFromHeaders,
  resolveAccessConfig,
} from "@/src/security/config";
import { AccessSessionRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

function reject(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Access denied" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/access", request.url));
}

export async function proxy(request: NextRequest) {
  try {
    const config = resolveAccessConfig();
    const clientIp = clientIpFromHeaders(request.headers);
    const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
    if (!clientIp || !isIpAllowed(clientIp, config.allowedCidrs) || !token) {
      return reject(request);
    }
    const payload = verifyAccessCookie({ token, signingKey: config.cookieSigningKey });
    if (!payload) return reject(request);
    const active = await new AccessSessionRepository(
      getDatabaseClient(),
    ).findActive(payload.sessionId);
    return active ? NextResponse.next() : reject(request);
  } catch {
    return reject(request);
  }
}

export const config = {
  matcher: [
    "/((?!access$|api/access/challenge|_next/static|_next/image|favicon.ico).*)",
  ],
};
