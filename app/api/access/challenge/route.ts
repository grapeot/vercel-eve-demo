import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  challengeMatches,
  isIpAllowed,
  issueAccessCookie,
  verifyAccessCookie,
} from "@/src/security/access";
import {
  ACCESS_COOKIE_NAME,
  clientIpFromHeaders,
  resolveAccessConfig,
} from "@/src/security/config";
import { AccessSessionRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

const inputSchema = z.object({ challenge: z.string().min(1).max(512) });
const denied = () => NextResponse.json({ error: "Access denied" }, { status: 401 });

export async function POST(request: NextRequest) {
  try {
    const config = resolveAccessConfig();
    const clientIp = clientIpFromHeaders(request.headers);
    const parsed = inputSchema.safeParse(await request.json());
    if (
      !clientIp ||
      !isIpAllowed(clientIp, config.allowedCidrs) ||
      !parsed.success ||
      !challengeMatches(parsed.data.challenge, config.challengeSecret)
    ) {
      return denied();
    }

    const { token, payload } = issueAccessCookie({
      signingKey: config.cookieSigningKey,
      ttlSeconds: config.cookieTtlSeconds,
    });
    const sessions = new AccessSessionRepository(getDatabaseClient());
    await sessions.create({
      id: payload.sessionId,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      clientIp,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    const response = NextResponse.json({ authorized: true });
    response.cookies.set(ACCESS_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: config.cookieTtlSeconds,
    });
    return response;
  } catch {
    return denied();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const config = resolveAccessConfig();
    const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
    const payload = token
      ? verifyAccessCookie({ token, signingKey: config.cookieSigningKey })
      : null;
    if (payload) {
      await new AccessSessionRepository(getDatabaseClient()).revoke(payload.sessionId);
    }
  } catch {
    // Logout remains idempotent even if the backing store is unavailable.
  }
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(ACCESS_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
