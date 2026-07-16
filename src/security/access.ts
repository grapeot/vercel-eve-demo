import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import ipaddr from "ipaddr.js";

export interface AccessCookiePayload {
  v: 1;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

function fixedLengthDigest(value: string): Buffer {
  return createHmac("sha256", "research-workbench-challenge").update(value).digest();
}

function decodeSigningKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new Error("ACCESS_COOKIE_SIGNING_KEY must contain exactly 32 bytes");
  }
  return key;
}

export function challengeMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(fixedLengthDigest(candidate), fixedLengthDigest(expected));
}

export function isIpAllowed(address: string, cidrs: readonly string[]): boolean {
  let parsedAddress: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsedAddress = ipaddr.process(address);
  } catch {
    return false;
  }
  return cidrs.some((cidr) => {
    try {
      const [range, prefix] = ipaddr.parseCIDR(cidr.trim());
      return parsedAddress.kind() === range.kind() && parsedAddress.match(range, prefix);
    } catch {
      return false;
    }
  });
}

export function issueAccessCookie(input: {
  signingKey: string;
  ttlSeconds: number;
  now?: Date;
  sessionId?: string;
}): { token: string; payload: AccessCookiePayload } {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const payload: AccessCookiePayload = {
    v: 1,
    sessionId: input.sessionId ?? randomUUID(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + input.ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", decodeSigningKey(input.signingKey))
    .update(encodedPayload)
    .digest("base64url");
  return { token: `${encodedPayload}.${signature}`, payload };
}

export function verifyAccessCookie(input: {
  token: string;
  signingKey: string;
  now?: Date;
}): AccessCookiePayload | null {
  const [encodedPayload, signature, extra] = input.token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  const expected = createHmac("sha256", decodeSigningKey(input.signingKey))
    .update(encodedPayload)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AccessCookiePayload;
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (
      payload.v !== 1 ||
      typeof payload.sessionId !== "string" ||
      !Number.isInteger(payload.issuedAt) ||
      !Number.isInteger(payload.expiresAt) ||
      payload.issuedAt > nowSeconds + 60 ||
      payload.expiresAt <= payload.issuedAt ||
      payload.expiresAt <= nowSeconds
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
