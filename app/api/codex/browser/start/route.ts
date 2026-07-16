import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { assertCodexEnabled, resolveCodexConfig } from "@/src/codex/config";
import { ensureLocalCodexCallbackServer } from "@/src/codex/local-callback";
import { createPkceAuthorization, stateHash } from "@/src/codex/oauth";
import { CredentialCipher } from "@/src/security/encryption";
import { authenticateOwnerRequest } from "@/src/security/request";
import { OAuthAttemptRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

export async function POST(request: NextRequest) {
  try {
    const owner = await authenticateOwnerRequest(request);
    if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 401 });
    if (process.env.VERCEL === "1") throw new Error("Browser PKCE is local-only");
    const config = resolveCodexConfig();
    assertCodexEnabled(config);
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!encryptionKey) throw new Error("Encryption unavailable");
    await ensureLocalCodexCallbackServer();

    const authorization = createPkceAuthorization(config);
    const attemptId = randomUUID();
    await new OAuthAttemptRepository(getDatabaseClient()).create({
      id: attemptId,
      accessSessionId: owner.accessSessionId,
      flow: "pkce",
      stateHash: stateHash(authorization.state),
      encryptedPayload: new CredentialCipher(encryptionKey).encrypt(
        JSON.stringify({ verifier: authorization.verifier }),
        `codex-attempt:${attemptId}`,
      ),
      redirectUri: "http://localhost:1455/auth/callback",
      pollIntervalSeconds: null,
      nextPollAt: null,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({
      attemptId,
      authorizeUrl: authorization.authorizeUrl,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Codex connection is unavailable" },
      { status: 503 },
    );
  }
}
