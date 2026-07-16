import type { Client } from "@libsql/client";

import { CredentialCipher } from "@/src/security/encryption";
import {
  OAuthCredentialRepository,
  type StoredCredential,
} from "@/src/storage/repositories";

import type { CodexConfig } from "./config";
import { CodexOAuthClient, extractAccountId, type CodexTokenResponse } from "./oauth";

const REFRESH_MARGIN_MS = 60_000;
const REFRESH_LEASE_MS = 15_000;

export interface ResolvedCodexCredential {
  accessToken: string;
  accountId: string;
  expiresAt: string;
}

const accessContext = (sessionId: string) => `codex:${sessionId}:access`;
const refreshContext = (sessionId: string) => `codex:${sessionId}:refresh`;

export class CodexCredentialService {
  private readonly repository: OAuthCredentialRepository;

  constructor(
    client: Client,
    private readonly cipher: CredentialCipher,
    private readonly oauth: CodexOAuthClient,
    private readonly now: () => number = Date.now,
  ) {
    this.repository = new OAuthCredentialRepository(client);
  }

  async storeTokens(
    accessSessionId: string,
    tokens: CodexTokenResponse,
  ): Promise<void> {
    const accountId = extractAccountId(tokens);
    if (!accountId) throw new Error("Codex token did not include an account identifier");
    await this.repository.upsert({
      accessSessionId,
      encryptedAccessToken: this.cipher.encrypt(
        tokens.access_token,
        accessContext(accessSessionId),
      ),
      encryptedRefreshToken: this.cipher.encrypt(
        tokens.refresh_token,
        refreshContext(accessSessionId),
      ),
      expiresAt: new Date(
        this.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      accountId,
      scope: tokens.scope ?? null,
    });
  }

  async resolve(accessSessionId: string): Promise<ResolvedCodexCredential> {
    let stored = await this.requireActive(accessSessionId);
    if (Date.parse(stored.expiresAt) <= this.now() + REFRESH_MARGIN_MS) {
      stored = await this.refreshWithLease(stored);
    }
    if (!stored.accountId) throw new Error("Codex credential has no account identifier");
    return {
      accessToken: this.cipher.decrypt(
        stored.encryptedAccessToken,
        accessContext(accessSessionId),
      ),
      accountId: stored.accountId,
      expiresAt: stored.expiresAt,
    };
  }

  private async requireActive(accessSessionId: string): Promise<StoredCredential> {
    const stored = await this.repository.findBySession(accessSessionId);
    if (!stored || stored.status !== "active") {
      throw new Error("Codex authorization is unavailable");
    }
    return stored;
  }

  private async refreshWithLease(stored: StoredCredential): Promise<StoredCredential> {
    const accessSessionId = stored.accessSessionId;
    const now = new Date(this.now()).toISOString();
    const acquired = await this.repository.acquireRefreshLease({
      accessSessionId,
      expectedVersion: stored.version,
      now,
      leaseUntil: new Date(this.now() + REFRESH_LEASE_MS).toISOString(),
    });
    if (!acquired) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const updated = await this.requireActive(accessSessionId);
        if (updated.version > stored.version) return updated;
      }
      throw new Error("Codex credential refresh is already in progress");
    }

    try {
      if (!stored.encryptedRefreshToken) {
        throw new Error("Codex authorization cannot be refreshed");
      }
      const refreshToken = this.cipher.decrypt(
        stored.encryptedRefreshToken,
        refreshContext(accessSessionId),
      );
      const tokens = await this.oauth.refresh(refreshToken);
      const rotated = await this.repository.rotateIfVersion(
        accessSessionId,
        stored.version,
        {
          encryptedAccessToken: this.cipher.encrypt(
            tokens.access_token,
            accessContext(accessSessionId),
          ),
          encryptedRefreshToken: this.cipher.encrypt(
            tokens.refresh_token,
            refreshContext(accessSessionId),
          ),
          expiresAt: new Date(
            this.now() + (tokens.expires_in ?? 3600) * 1000,
          ).toISOString(),
        },
      );
      if (!rotated) return this.requireActive(accessSessionId);
      return this.requireActive(accessSessionId);
    } catch (error) {
      await this.repository.releaseRefreshLease(accessSessionId, stored.version);
      throw error;
    }
  }
}

export function createCredentialService(input: {
  client: Client;
  config: CodexConfig;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): CodexCredentialService {
  return new CodexCredentialService(
    input.client,
    new CredentialCipher(input.encryptionKey),
    new CodexOAuthClient(input.config, input.fetchImpl),
    input.now,
  );
}
