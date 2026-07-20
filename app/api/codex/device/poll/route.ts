import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertCodexEnabled, resolveCodexConfig } from "@/src/codex/config";
import { createCredentialService } from "@/src/codex/credentials";
import { CodexOAuthClient } from "@/src/codex/oauth";
import { CredentialCipher } from "@/src/security/encryption";
import { authenticateOwnerRequest } from "@/src/security/request";
import { OAuthAttemptRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

const inputSchema = z.object({ attemptId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const owner = await authenticateOwnerRequest(request);
    const input = inputSchema.safeParse(await request.json());
    if (!owner || !input.success) {
      return NextResponse.json({ error: "Access denied" }, { status: 401 });
    }
    const config = resolveCodexConfig();
    assertCodexEnabled(config);
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey) throw new Error("Encryption unavailable");

    const attempts = new OAuthAttemptRepository(getDatabaseClient());
    const attempt = await attempts.findPending(
      input.data.attemptId,
      owner.accessSessionId,
    );
    if (!attempt || attempt.flow !== "device" || !attempt.pollIntervalSeconds) {
      return NextResponse.json({ error: "Authorization attempt expired" }, { status: 410 });
    }
    const now = Date.now();
    const claimed = await attempts.claimDevicePoll({
      id: attempt.id,
      accessSessionId: owner.accessSessionId,
      now: new Date(now).toISOString(),
      nextPollAt: new Date(now + attempt.pollIntervalSeconds * 1000).toISOString(),
    });
    if (!claimed) {
      return NextResponse.json(
        { status: "pending", retryAfterSeconds: attempt.pollIntervalSeconds },
        { status: 202 },
      );
    }

    const cipher = new CredentialCipher(encryptionKey);
    const payload = z
      .object({ deviceAuthId: z.string().min(1), userCode: z.string().min(1) })
      .parse(
        JSON.parse(cipher.decrypt(attempt.encryptedPayload, `codex-attempt:${attempt.id}`)),
      );
    const oauth = new CodexOAuthClient(config);
    const polled = await oauth.pollDeviceAuthorization(payload);
    if (polled.status === "pending") {
      return NextResponse.json(
        { status: "pending", retryAfterSeconds: attempt.pollIntervalSeconds },
        { status: 202 },
      );
    }
    const tokens = await oauth.exchangeAuthorizationCode({
      code: polled.authorizationCode,
      verifier: polled.codeVerifier,
      redirectUri: attempt.redirectUri!,
    });
    const stored = await createCredentialService({
      client: getDatabaseClient(),
      config,
      encryptionKey,
    }).storeTokensFromAttempt(tokens, attempt.id, attempt.accessSessionId);
    if (!stored) {
      return NextResponse.json({ error: "Authorization attempt expired" }, { status: 410 });
    }
    return NextResponse.json({ status: "connected" });
  } catch {
    return NextResponse.json(
      { error: "Codex connection is unavailable" },
      { status: 503 },
    );
  }
}
