import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { getDatabaseClient } from "@/src/storage/server";

import { assertCodexEnabled, resolveCodexConfig } from "./config";
import { createCredentialService } from "./credentials";

export function createCodexFetch(input: {
  accessToken: string;
  accountId: string;
  apiEndpoint: string;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const fetchImpl = input.fetchImpl ?? fetch;
  return async (request, init) => {
    const headers = new Headers(
      init?.headers ?? (request instanceof Request ? request.headers : undefined),
    );
    headers.delete("authorization");
    headers.set("authorization", `Bearer ${input.accessToken}`);
    headers.set("ChatGPT-Account-Id", input.accountId);
    headers.set("originator", "eve");
    const url = new URL(
      typeof request === "string" || request instanceof URL ? request : request.url,
    );
    if (!url.pathname.includes("/responses")) {
      throw new Error("Codex transport rejected an unexpected endpoint");
    }
    const target =
      request instanceof Request
        ? new Request(input.apiEndpoint, request)
        : input.apiEndpoint;
    return fetchImpl(target, { ...init, headers });
  };
}

export async function resolveCodexModel(
  accessSessionId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LanguageModel> {
  const config = resolveCodexConfig(env);
  assertCodexEnabled(config);
  if (!env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error("Credential encryption is unavailable");
  }
  const credential = await createCredentialService({
    client: getDatabaseClient(),
    config,
    encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
  }).resolve(accessSessionId);
  return createOpenAI({
    name: "codex-owner",
    apiKey: "codex-owner-auth",
    fetch: createCodexFetch({
      accessToken: credential.accessToken,
      accountId: credential.accountId,
      apiEndpoint: config.apiEndpoint,
    }),
  }).responses(config.model);
}
