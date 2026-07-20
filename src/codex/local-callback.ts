import { createServer, type Server } from "node:http";

import { z } from "zod";

import { CredentialCipher } from "@/src/security/encryption";
import { OAuthAttemptRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

import { assertCodexEnabled, resolveCodexConfig } from "./config";
import { createCredentialService } from "./credentials";
import { CodexOAuthClient, stateHash } from "./oauth";

const callbackPayloadSchema = z.object({ verifier: z.string().min(43) });
const callbackPort = 1455;

const globalCallback = globalThis as typeof globalThis & {
  codexCallbackServer?: Server;
  codexCallbackStarting?: Promise<void>;
};

function html(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Codex connection</title></head><body><main><h1>${message}</h1><p>You can close this tab and return to the Research Workbench.</p></main></body></html>`;
}

export async function ensureLocalCodexCallbackServer(): Promise<void> {
  if (process.env.VERCEL === "1") {
    throw new Error("Local Codex callback is not available on Vercel");
  }
  if (globalCallback.codexCallbackServer?.listening) return;
  if (globalCallback.codexCallbackStarting) return globalCallback.codexCallbackStarting;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${callbackPort}`);
    if (url.pathname !== "/auth/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    try {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !code) throw new Error("Missing OAuth callback parameters");
      const attempts = new OAuthAttemptRepository(getDatabaseClient());
      const attempt = await attempts.findPendingByStateHash(stateHash(state));
      if (!attempt || attempt.flow !== "pkce" || !attempt.redirectUri) {
        throw new Error("OAuth attempt expired");
      }
      const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
      if (!encryptionKey) throw new Error("Encryption unavailable");
      const payload = callbackPayloadSchema.parse(
        JSON.parse(
          new CredentialCipher(encryptionKey).decrypt(
            attempt.encryptedPayload,
            `codex-attempt:${attempt.id}`,
          ),
        ),
      );
      const config = resolveCodexConfig();
      assertCodexEnabled(config);
      const tokens = await new CodexOAuthClient(config).exchangeAuthorizationCode({
        code,
        verifier: payload.verifier,
        redirectUri: attempt.redirectUri,
      });
      const stored = await createCredentialService({
        client: getDatabaseClient(),
        config,
        encryptionKey,
      }).storeTokensFromAttempt(tokens, attempt.id, attempt.accessSessionId);
      if (!stored) throw new Error("OAuth attempt was revoked before completion");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html("ChatGPT/Codex connected"));
    } catch {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html("Codex connection failed"));
    }
  });
  globalCallback.codexCallbackStarting = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(callbackPort, "localhost", () => {
      server.off("error", reject);
      globalCallback.codexCallbackServer = server;
      resolve();
    });
  }).finally(() => {
    globalCallback.codexCallbackStarting = undefined;
  });
  return globalCallback.codexCallbackStarting;
}
