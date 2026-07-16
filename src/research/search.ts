import { z } from "zod";

import type { RuntimeConfig } from "@/src/config";
import { tavilyUsage, usageSchema } from "@/src/research/usage";

export const searchInputSchema = z.object({
  query: z.string().trim().min(3).max(500),
  depth: z.enum(["basic", "advanced"]).default("advanced"),
  maxResults: z.number().int().min(1).max(10).default(6),
  topic: z.enum(["general", "news", "finance"]).default("general"),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
  includeDomains: z.array(z.string().min(1)).max(20).default([]),
  excludeDomains: z.array(z.string().min(1)).max(20).default([]),
});

export const sourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  excerpt: z.string(),
  score: z.number().nullable(),
  publishedDate: z.string().nullable(),
});

export const searchOutputSchema = z.object({
  query: z.string(),
  backend: z.enum(["mock", "tavily"]),
  sources: z.array(sourceSchema),
  usage: usageSchema,
});

export type SearchInput = z.input<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;

const tavilyResponseSchema = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string(),
        content: z.string().optional(),
        score: z.number().optional(),
        published_date: z.string().nullable().optional(),
      }),
    )
    .default([]),
  usage: z.object({ credits: z.number().nonnegative().optional() }).nullish(),
});

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
        publishedDate: null,
      },
      {
        title: "合成来源：独立工程复盘",
        url: "https://engineering.example.org/research-review",
        excerpt: "该来源模拟独立验证，强调 durable execution、credential 边界和失败恢复。",
        score: 0.88,
        publishedDate: null,
      },
    ],
    usage: tavilyUsage(0),
  };
}

export async function executeSearch(
  rawInput: SearchInput,
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchOutput> {
  const input = searchInputSchema.parse(rawInput);
  if (config.searchBackend === "mock") return mockSearch(input.query);
  if (!config.allowLiveApi || !config.tavilyApiKey) {
    throw new Error("Tavily live call is not authorized");
  }

  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.tavilyApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      search_depth: input.depth,
      max_results: input.maxResults,
      topic: input.topic,
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
      ...(input.timeRange ? { time_range: input.timeRange } : {}),
      ...(input.includeDomains.length > 0
        ? { include_domains: input.includeDomains }
        : {}),
      ...(input.excludeDomains.length > 0
        ? { exclude_domains: input.excludeDomains }
        : {}),
    }),
  });
  if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}`);
  const parsed = tavilyResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Tavily search returned an invalid response");

  const sources = parsed.data.results.flatMap((result) => {
    try {
      new URL(result.url);
    } catch {
      return [];
    }
    return [
      {
        title: result.title ?? "Untitled source",
        url: result.url,
        excerpt: result.content ?? "",
        score: result.score ?? null,
        publishedDate: result.published_date ?? null,
      },
    ];
  });
  return searchOutputSchema.parse({
    query: parsed.data.query ?? input.query,
    backend: "tavily",
    sources,
    usage: tavilyUsage(
      parsed.data.usage?.credits ?? (input.depth === "advanced" ? 2 : 1),
    ),
  });
}
