import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  challengeMatches,
  isIpAllowed,
  issueAccessCookie,
  verifyAccessCookie,
} from "@/src/security/access";
import { CredentialCipher } from "@/src/security/encryption";
import {
  clientIpFromHeaders,
  resolveAccessConfig,
} from "@/src/security/config";

const key = () => randomBytes(32).toString("base64url");

describe("CredentialCipher", () => {
  it("round-trips a credential only with the same context", () => {
    const cipher = new CredentialCipher(key());
    const encrypted = cipher.encrypt("refresh-secret", "credential:example:refresh");

    expect(encrypted).not.toContain("refresh-secret");
    expect(cipher.decrypt(encrypted, "credential:example:refresh")).toBe(
      "refresh-secret",
    );
    expect(() => cipher.decrypt(encrypted, "credential:other:refresh")).toThrow(
      "authentication failed",
    );
  });

  it("rejects malformed keys and tampered envelopes", () => {
    expect(() => new CredentialCipher("too-short")).toThrow("32 bytes");
    const cipher = new CredentialCipher(key());
    const encrypted = cipher.encrypt("token", "credential:id:access");
    expect(() =>
      cipher.decrypt(`${encrypted.slice(0, -2)}aa`, "credential:id:access"),
    ).toThrow();
  });
});

describe("access security", () => {
  it("compares challenges without a length-dependent early return", () => {
    expect(challengeMatches("correct", "correct")).toBe(true);
    expect(challengeMatches("wrong", "correct")).toBe(false);
    expect(challengeMatches("x", "a-much-longer-value")).toBe(false);
  });

  it("signs, verifies, expires, and rejects modified cookies", () => {
    const signingKey = key();
    const now = new Date("2026-07-16T12:00:00.000Z");
    const { token, payload } = issueAccessCookie({
      signingKey,
      ttlSeconds: 300,
      now,
      sessionId: "session-1",
    });

    expect(verifyAccessCookie({ token, signingKey, now })).toEqual(payload);
    expect(
      verifyAccessCookie({
        token,
        signingKey,
        now: new Date("2026-07-16T12:05:01.000Z"),
      }),
    ).toBeNull();
    expect(
      verifyAccessCookie({ token: `${token}x`, signingKey, now }),
    ).toBeNull();
  });

  it("matches IPv4 and IPv6 CIDRs and rejects malformed input", () => {
    const allowed = ["192.0.2.0/24", "127.0.0.1/32", "::1/128"];
    expect(isIpAllowed("192.0.2.66", allowed)).toBe(true);
    expect(isIpAllowed("127.0.0.1", allowed)).toBe(true);
    expect(isIpAllowed("::1", allowed)).toBe(true);
    expect(isIpAllowed("198.51.100.1", allowed)).toBe(false);
    expect(isIpAllowed("not-an-ip", allowed)).toBe(false);
  });

  it("trusts only the Vercel-owned client IP header in production", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.10",
      "x-vercel-forwarded-for": "192.0.2.20, 10.0.0.1",
    });
    expect(clientIpFromHeaders(headers, true)).toBe("192.0.2.20");
    expect(clientIpFromHeaders(headers, false)).toBe("198.51.100.10");
  });

  it("fails closed when access config is incomplete", () => {
    expect(() => resolveAccessConfig({})).toThrow("ACCESS_ALLOWED_CIDRS");
    expect(() =>
      resolveAccessConfig({
        ACCESS_ALLOWED_CIDRS: "127.0.0.1/32",
        ACCESS_CHALLENGE_SECRET: key(),
        ACCESS_COOKIE_SIGNING_KEY: key(),
        ACCESS_COOKIE_TTL_SECONDS: "30",
      }),
    ).toThrow("ACCESS_COOKIE_TTL_SECONDS");
  });
});
