import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { assertCodexEnabled, resolveCodexConfig } from "@/src/codex/config";
import { CodexOAuthClient } from "@/src/codex/oauth";
import { CredentialCipher } from "@/src/security/encryption";
import { authenticateOwnerRequest } from "@/src/security/request";
import { OAuthAttemptRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

export async function POST(request: NextRequest) {
  try {
    const owner = await authenticateOwnerRequest(request);
    if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 401 });
    const config = resolveCodexConfig();
    assertCodexEnabled(config);
    if (!process.env.CREDENTIAL_ENCRYPTION_KEY) throw new Error("Encryption unavailable");

    const device = await new CodexOAuthClient(config).startDeviceAuthorization();
    const attemptId = randomUUID();
    const cipher = new CredentialCipher(process.env.CREDENTIAL_ENCRYPTION_KEY);
    const now = Date.now();
    await new OAuthAttemptRepository(getDatabaseClient()).create({
      id: attemptId,
      accessSessionId: owner.accessSessionId,
      flow: "device",
      stateHash: null,
      encryptedPayload: cipher.encrypt(
        JSON.stringify({
          deviceAuthId: device.deviceAuthId,
          userCode: device.userCode,
        }),
        `codex-attempt:${attemptId}`,
      ),
      redirectUri: "https://auth.openai.com/deviceauth/callback",
      pollIntervalSeconds: device.intervalSeconds,
      nextPollAt: new Date(now + device.intervalSeconds * 1000).toISOString(),
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({
      attemptId,
      userCode: device.userCode,
      verificationUrl: device.verificationUrl,
      intervalSeconds: device.intervalSeconds,
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Codex connection is unavailable" },
      { status: 503 },
    );
  }
}
