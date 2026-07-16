import { randomBytes } from "node:crypto";

import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCodexConfig } from "@/src/codex/config";
import { createCredentialService } from "@/src/codex/credentials";
import { createCodexFetch } from "@/src/codex/model";
import {
  CodexOAuthClient,
  createPkceAuthorization,
  extractAccountId,
  stateHash,
} from "@/src/codex/oauth";
import { AccessSessionRepository } from "@/src/storage/repositories";
import { migrateDatabase } from "@/src/storage/schema";

function jwt(claims: unknown): string {
  return ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(
    ".",
  );
}

const config = resolveCodexConfig({ CODEX_EXPERIMENT_ENABLED: "1" });

describe("Codex OAuth client", () => {
  it("builds a state-bound S256 localhost authorization URL", () => {
    const auth = createPkceAuthorization(config);
    const url = new URL(auth.authorizeUrl);
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:1455/auth/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(stateHash(auth.state)).toHaveLength(43);
    expect(auth.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("starts and polls the device flow with validated schemas", async () => {
    const responses = [
      new Response(
        JSON.stringify({ device_auth_id: "device-1", user_code: "ABCD-EFGH", interval: "2" }),
        { status: 200 },
      ),
      new Response(null, { status: 403 }),
      new Response(
        JSON.stringify({ authorization_code: "code-1", code_verifier: "verifier-1" }),
        { status: 200 },
      ),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const client = new CodexOAuthClient(config, fetchImpl as typeof fetch);

    await expect(client.startDeviceAuthorization()).resolves.toMatchObject({
      deviceAuthId: "device-1",
      userCode: "ABCD-EFGH",
      intervalSeconds: 2,
    });
    await expect(
      client.pollDeviceAuthorization({ deviceAuthId: "device-1", userCode: "ABCD-EFGH" }),
    ).resolves.toEqual({ status: "pending" });
    await expect(
      client.pollDeviceAuthorization({ deviceAuthId: "device-1", userCode: "ABCD-EFGH" }),
    ).resolves.toEqual({
      status: "authorized",
      authorizationCode: "code-1",
      codeVerifier: "verifier-1",
    });
  });

  it("extracts the account ID only as metadata from a token response", () => {
    expect(
      extractAccountId({
        access_token: jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }),
        refresh_token: "refresh",
      }),
    ).toBe("acct-1");
  });
});

describe("Codex credential and transport", () => {
  let client: ReturnType<typeof createClient>;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await migrateDatabase(client);
    await new AccessSessionRepository(client).create({
      id: "access-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => client.close());

  it("refreshes once under a database lease and never stores plaintext tokens", async () => {
    const now = Date.parse("2026-07-16T12:00:00.000Z");
    const refreshedAccess = jwt({ chatgpt_account_id: "acct-1" });
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: refreshedAccess,
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    const encryptionKey = randomBytes(32).toString("base64url");
    const service = createCredentialService({
      client,
      config,
      encryptionKey,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now,
    });
    await service.storeTokens("access-1", {
      access_token: jwt({ chatgpt_account_id: "acct-1" }),
      refresh_token: "initial-refresh",
      expires_in: 1,
    });

    const secondInstance = createCredentialService({
      client,
      config,
      encryptionKey,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => now + 2_000,
    });
    const [first, second] = await Promise.all([
      secondInstance.resolve("access-1"),
      secondInstance.resolve("access-1"),
    ]);
    expect(first.accessToken).toBe(refreshedAccess);
    expect(second.accessToken).toBe(refreshedAccess);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const stored = await client.execute(
      "SELECT encrypted_access_token, encrypted_refresh_token FROM oauth_credentials",
    );
    const serialized = JSON.stringify(stored.rows);
    expect(serialized).not.toContain("rotated-refresh");
    expect(serialized).not.toContain(refreshedAccess);
  });

  it("rewrites only Responses calls and replaces generated authorization", async () => {
    const fetchImpl = vi.fn<
      (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response("ok"));
    const codexFetch = createCodexFetch({
      accessToken: "private-access",
      accountId: "acct-1",
      apiEndpoint: "https://chatgpt.example/backend-api/codex/responses",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await codexFetch("https://api.openai.example/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer placeholder" },
      body: "{}",
    });

    const [target, init] = fetchImpl.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(target).toBe("https://chatgpt.example/backend-api/codex/responses");
    expect(headers.get("authorization")).toBe("Bearer private-access");
    expect(headers.get("ChatGPT-Account-Id")).toBe("acct-1");
    expect(headers.get("originator")).toBe("eve");
    await expect(codexFetch("https://unexpected.example/v1/models")).rejects.toThrow(
      "unexpected endpoint",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
