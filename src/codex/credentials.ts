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
export const OWNER_CREDENTIAL_ID = "owner";

export interface ResolvedCodexCredential {
  accessToken: string;
  accountId: string;
  expiresAt: string;
}

const accessContext = (ownerId: string) => `codex:${ownerId}:access`;
const refreshContext = (ownerId: string) => `codex:${ownerId}:refresh`;

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

  async storeTokens(tokens: CodexTokenResponse): Promise<void> {
    const accountId = extractAccountId(tokens);
    if (!accountId) throw new Error("Codex token did not include an account identifier");
    await this.repository.upsert({
      ownerId: OWNER_CREDENTIAL_ID,
      legacyAccessSessionId: null,
      encryptedAccessToken: this.cipher.encrypt(
        tokens.access_token,
        accessContext(OWNER_CREDENTIAL_ID),
      ),
      encryptedRefreshToken: this.cipher.encrypt(
        tokens.refresh_token,
        refreshContext(OWNER_CREDENTIAL_ID),
      ),
      expiresAt: new Date(
        this.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      accountId,
      scope: tokens.scope ?? null,
    });
  }

  async resolve(): Promise<ResolvedCodexCredential> {
    let stored = await this.requireActive();
    if (stored.legacyAccessSessionId) {
      const legacyId = stored.legacyAccessSessionId;
      const accessToken = this.cipher.decrypt(
        stored.encryptedAccessToken,
        accessContext(legacyId),
      );
      const refreshToken = stored.encryptedRefreshToken
        ? this.cipher.decrypt(stored.encryptedRefreshToken, refreshContext(legacyId))
        : null;
      await this.repository.rewrapLegacyIfVersion(
        OWNER_CREDENTIAL_ID,
        stored.version,
        this.cipher.encrypt(accessToken, accessContext(OWNER_CREDENTIAL_ID)),
        refreshToken
          ? this.cipher.encrypt(refreshToken, refreshContext(OWNER_CREDENTIAL_ID))
          : null,
      );
      stored = await this.requireActive();
    }
    if (Date.parse(stored.expiresAt) <= this.now() + REFRESH_MARGIN_MS) {
      stored = await this.refreshWithLease(stored);
    }
    if (!stored.accountId) throw new Error("Codex credential has no account identifier");
    return {
      accessToken: this.cipher.decrypt(
        stored.encryptedAccessToken,
        accessContext(OWNER_CREDENTIAL_ID),
      ),
      accountId: stored.accountId,
      expiresAt: stored.expiresAt,
    };
  }

  private async requireActive(): Promise<StoredCredential> {
    const stored = await this.repository.findByOwner(OWNER_CREDENTIAL_ID);
    if (!stored || stored.status !== "active") {
      throw new Error("Codex authorization is unavailable");
    }
    return stored;
  }

  private async refreshWithLease(stored: StoredCredential): Promise<StoredCredential> {
    const ownerId = stored.ownerId;
    const now = new Date(this.now()).toISOString();
    const acquired = await this.repository.acquireRefreshLease({
      ownerId,
      expectedVersion: stored.version,
      now,
      leaseUntil: new Date(this.now() + REFRESH_LEASE_MS).toISOString(),
    });
    if (!acquired) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const updated = await this.requireActive();
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
        refreshContext(ownerId),
      );
      const tokens = await this.oauth.refresh(refreshToken);
      const rotated = await this.repository.rotateIfVersion(
        ownerId,
        stored.version,
        {
          encryptedAccessToken: this.cipher.encrypt(
            tokens.access_token,
            accessContext(ownerId),
          ),
          encryptedRefreshToken: this.cipher.encrypt(
            tokens.refresh_token,
            refreshContext(ownerId),
          ),
          expiresAt: new Date(
            this.now() + (tokens.expires_in ?? 3600) * 1000,
          ).toISOString(),
        },
      );
      if (!rotated) return this.requireActive();
      return this.requireActive();
    } catch (error) {
      await this.repository.releaseRefreshLease(ownerId, stored.version);
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
