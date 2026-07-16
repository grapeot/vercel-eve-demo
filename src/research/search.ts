import { z } from "zod";

import type { RuntimeConfig } from "@/src/config";
import { tavilyUsage, usageSchema } from "@/src/research/usage";

export const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(500),
  depth: z.enum(["basic", "advanced"]).default("advanced"),
  maxResults: z.number().int().min(1).max(10).default(6),
});

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  excerpt: z.string(),
  score: z.number().nullable(),
});

export const searchOutputSchema = z.object({
  query: z.string(),
  backend: z.enum(["mock", "tavily"]),
  sources: z.array(sourceSchema),
  usage: usageSchema,
});

export type SearchInput = z.input<typeof searchInputSchema>;
export type ParsedSearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
}

interface TavilyCliEnvelope {
  command?: unknown;
  data?: {
    query?: unknown;
    results?: unknown;
    usage?: { credits?: unknown } | null;
  };
}

function mockSearch(query: string): SearchOutput {
  return {
    query,
    backend: "mock",
    sources: [
      {
        title: "合成来源：平台文档",
        url: "https://docs.example.com/agent-runtime",
        excerpt: `这是离线 fixture，用来验证「${query}」的来源整理与引用流程。`,
        score: 0.96,
      },
      {
        title: "合成来源：独立工程复盘",
        url: "https://engineering.example.org/research-review",
        excerpt: "该来源模拟独立验证，强调 durable execution、credential 边界和失败恢复。",
        score: 0.88,
      },
    ],
    usage: tavilyUsage(0),
  };
}

function normalizeTavilyResult(result: TavilyResult) {
  if (typeof result.url !== "string") return null;
  try {
    new URL(result.url);
  } catch {
    return null;
  }

  return {
    title: typeof result.title === "string" ? result.title : "Untitled source",
    url: result.url,
    excerpt: typeof result.content === "string" ? result.content : "",
    score: typeof result.score === "number" ? result.score : null,
  };
}

export async function executeSearch(
  rawInput: SearchInput,
  config: RuntimeConfig,
  runCli?: (input: ParsedSearchInput) => Promise<string>,
): Promise<SearchOutput> {
  const input = searchInputSchema.parse(rawInput);
  if (config.searchBackend === "mock") return mockSearch(input.query);

  if (!config.allowLiveApi || !config.tavilyApiKey) {
    throw new Error("Tavily live 调用未授权或缺少 credential");
  }

  if (!runCli) throw new Error("Tavily 后端缺少 Sandbox CLI runner");
  let payload: TavilyCliEnvelope;
  try {
    payload = JSON.parse(await runCli(input)) as TavilyCliEnvelope;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Tavily CLI 返回无效 JSON");
    throw error;
  }
  if (payload.command !== "search" || !payload.data) {
    throw new Error("Tavily CLI 返回无效 envelope");
  }

  const rawResults = Array.isArray(payload.data.results)
    ? (payload.data.results as TavilyResult[])
    : [];
  const sources = rawResults
    .map(normalizeTavilyResult)
    .filter((source): source is NonNullable<typeof source> => source !== null);
  const reportedCredits = payload.data.usage?.credits;
  const credits =
    typeof reportedCredits === "number"
      ? reportedCredits
      : input.depth === "advanced"
        ? 2
        : 1;

  return searchOutputSchema.parse({
    query: typeof payload.data.query === "string" ? payload.data.query : input.query,
    backend: "tavily",
    sources,
    usage: tavilyUsage(credits),
  });
}
