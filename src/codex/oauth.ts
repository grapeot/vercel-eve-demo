import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type { CodexConfig } from "./config";

const deviceStartSchema = z.object({
  device_auth_id: z.string().min(1),
  user_code: z.string().min(1),
  interval: z.union([z.string(), z.number()]).optional(),
});
const devicePollSchema = z.object({
  authorization_code: z.string().min(1),
  code_verifier: z.string().min(1),
});
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  scope: z.string().optional(),
});

export type CodexTokenResponse = z.infer<typeof tokenResponseSchema>;

export interface DeviceAuthorization {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  verificationUrl: string;
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "authorized"; authorizationCode: string; codeVerifier: string };

export interface PkceAuthorization {
  state: string;
  verifier: string;
  authorizeUrl: string;
}

async function validatedJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  operation: string,
): Promise<T> {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error(`${operation} returned an invalid response`);
  return parsed.data;
}

export function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("base64url");
}

export function createPkceAuthorization(
  config: CodexConfig,
  redirectUri = "http://localhost:1455/auth/callback",
): PkceAuthorization {
  const verifier = randomBytes(64).toString("base64url").slice(0, 64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL("/oauth/authorize", config.issuer);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  }).toString();
  return { state, verifier, authorizeUrl: url.toString() };
}

export class CodexOAuthClient {
  constructor(
    private readonly config: CodexConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async startDeviceAuthorization(): Promise<DeviceAuthorization> {
    const response = await this.fetchImpl(
      new URL("/api/accounts/deviceauth/usercode", this.config.issuer),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": this.config.userAgent,
        },
        body: JSON.stringify({ client_id: this.config.clientId }),
      },
    );
    const data = await validatedJson(response, deviceStartSchema, "Device authorization");
    const interval = Number.parseInt(String(data.interval ?? "5"), 10);
    return {
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      intervalSeconds: Number.isFinite(interval) ? Math.max(interval, 1) : 5,
      verificationUrl: new URL("/codex/device", this.config.issuer).toString(),
    };
  }

  async pollDeviceAuthorization(input: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<DevicePollResult> {
    const response = await this.fetchImpl(
      new URL("/api/accounts/deviceauth/token", this.config.issuer),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": this.config.userAgent,
        },
        body: JSON.stringify({
          device_auth_id: input.deviceAuthId,
          user_code: input.userCode,
        }),
      },
    );
    if (response.status === 403 || response.status === 404) return { status: "pending" };
    const data = await validatedJson(response, devicePollSchema, "Device polling");
    return {
      status: "authorized",
      authorizationCode: data.authorization_code,
      codeVerifier: data.code_verifier,
    };
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    verifier: string;
    redirectUri: string;
  }): Promise<CodexTokenResponse> {
    return this.tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.config.clientId,
        code_verifier: input.verifier,
      }),
      "Token exchange",
    );
  }

  async refresh(refreshToken: string): Promise<CodexTokenResponse> {
    return this.tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
      "Token refresh",
    );
  }

  private async tokenRequest(
    body: URLSearchParams,
    operation: string,
  ): Promise<CodexTokenResponse> {
    const response = await this.fetchImpl(new URL("/oauth/token", this.config.issuer), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return validatedJson(response, tokenResponseSchema, operation);
  }
}

interface JwtClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
}

function parseJwtClaims(token: string | undefined): JwtClaims | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function extractAccountId(tokens: CodexTokenResponse): string | null {
  for (const token of [tokens.id_token, tokens.access_token]) {
    const claims = parseJwtClaims(token);
    const accountId =
      claims?.chatgpt_account_id ??
      claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
      claims?.organizations?.[0]?.id;
    if (accountId) return accountId;
  }
  return null;
}
