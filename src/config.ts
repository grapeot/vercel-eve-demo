import { z } from "zod";

const positiveNumber = z.coerce.number().positive();
const positiveInteger = z.coerce.number().int().positive();

export type DemoMode = "mock" | "live";
export type SearchBackend = "mock" | "tavily";

export interface RuntimeConfig {
  mode: DemoMode;
  searchBackend: SearchBackend;
  allowLiveApi: boolean;
  model: string;
  budgetUsd: number;
  maxSearches: number;
  tavilyApiKey?: string;
  tavilyProject?: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  const resolved = value ?? fallback;
  if (!allowed.includes(resolved as T)) {
    throw new Error(`${name} 必须是 ${allowed.join(" 或 ")}`);
  }
  return resolved as T;
}

export function resolveRuntimeConfig(
  env: Environment = process.env,
): RuntimeConfig {
  const mode = readEnum(env.EVE_DEMO_MODE, ["mock", "live"], "mock", "EVE_DEMO_MODE");
  const searchBackend = readEnum(
    env.SEARCH_BACKEND,
    ["mock", "tavily"],
    "mock",
    "SEARCH_BACKEND",
  );
  const allowLiveApi = env.ALLOW_LIVE_API === "1";

  if (mode === "live" && !allowLiveApi) {
    throw new Error("live 模式要求 ALLOW_LIVE_API=1");
  }
  if (searchBackend === "tavily" && !allowLiveApi) {
    throw new Error("Tavily 后端要求 ALLOW_LIVE_API=1");
  }
  if (searchBackend === "tavily" && !env.TAVILY_API_KEY) {
    throw new Error("Tavily 后端缺少 TAVILY_API_KEY");
  }

  return {
    mode,
    searchBackend,
    allowLiveApi,
    model: env.EVE_MODEL || "openai/gpt-5.4-mini",
    budgetUsd: positiveNumber.parse(env.RESEARCH_BUDGET_USD ?? "2"),
    maxSearches: positiveInteger.parse(env.RESEARCH_MAX_SEARCHES ?? "10"),
    tavilyApiKey: env.TAVILY_API_KEY,
    tavilyProject: env.TAVILY_PROJECT,
  };
}

export function publicRuntimeConfig(config: RuntimeConfig) {
  return {
    mode: config.mode,
    searchBackend: config.searchBackend,
    model: config.mode === "live" ? config.model : "deterministic-mock",
    budgetUsd: config.budgetUsd,
    maxSearches: config.maxSearches,
    credentialConfigured:
      config.searchBackend === "mock" || Boolean(config.tavilyApiKey),
  };
}
