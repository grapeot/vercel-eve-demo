export interface CodexConfig {
  enabled: boolean;
  clientId: string;
  issuer: string;
  apiEndpoint: string;
  model: string;
  userAgent: string;
}

export function resolveCodexConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CodexConfig {
  return {
    enabled: env.CODEX_EXPERIMENT_ENABLED === "1",
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    issuer: "https://auth.openai.com",
    apiEndpoint: "https://chatgpt.com/backend-api/codex/responses",
    model: env.CODEX_MODEL || "gpt-5.6-sol",
    userAgent: "personal-research-workbench/0.1",
  };
}

export function assertCodexEnabled(config: CodexConfig): void {
  if (!config.enabled) {
    throw new Error("Codex compatibility experiment is disabled");
  }
}
