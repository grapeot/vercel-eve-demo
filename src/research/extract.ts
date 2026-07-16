import { z } from "zod";

import type { RuntimeConfig } from "@/src/config";
import { tavilyUsage, usageSchema } from "@/src/research/usage";

export const extractInputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(5),
  depth: z.enum(["basic", "advanced"]).default("advanced"),
  query: z.string().trim().min(3).max(500).optional(),
  chunksPerSource: z.number().int().min(1).max(5).optional(),
});

export const extractOutputSchema = z.object({
  backend: z.enum(["mock", "tavily"]),
  results: z.array(
    z.object({
      url: z.string().url(),
      content: z.string(),
    }),
  ),
  failedUrls: z.array(z.string()),
  usage: usageSchema,
});

export type ExtractInput = z.input<typeof extractInputSchema>;

const tavilyExtractSchema = z.object({
  results: z
    .array(z.object({ url: z.string(), raw_content: z.string().optional() }))
    .default([]),
  failed_results: z
    .array(z.union([z.string(), z.object({ url: z.string().optional() })]))
    .default([]),
  usage: z.object({ credits: z.number().nonnegative().optional() }).nullish(),
});

export async function executeExtract(
  rawInput: ExtractInput,
  config: RuntimeConfig,
  fetchImpl: typeof fetch = fetch,
) {
  const input = extractInputSchema.parse(rawInput);
  if (config.searchBackend === "mock") {
    return extractOutputSchema.parse({
      backend: "mock",
      results: input.urls.map((url) => ({
        url,
        content: `# Synthetic extract\n\nOffline fixture for ${url}.`,
      })),
      failedUrls: [],
      usage: tavilyUsage(0),
    });
  }
  if (!config.allowLiveApi || !config.tavilyApiKey) {
    throw new Error("Tavily live call is not authorized");
  }

  const response = await fetchImpl("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.tavilyApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: input.urls,
      extract_depth: input.depth,
      format: "markdown",
      include_images: false,
      include_usage: true,
      ...(input.query ? { query: input.query } : {}),
      ...(input.chunksPerSource
        ? { chunks_per_source: input.chunksPerSource }
        : {}),
    }),
  });
  if (!response.ok) throw new Error(`Tavily extract failed with HTTP ${response.status}`);
  const parsed = tavilyExtractSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Tavily extract returned an invalid response");
  return extractOutputSchema.parse({
    backend: "tavily",
    results: parsed.data.results.flatMap((result) => {
      try {
        new URL(result.url);
      } catch {
        return [];
      }
      return [{ url: result.url, content: result.raw_content ?? "" }];
    }),
    failedUrls: parsed.data.failed_results.flatMap((failure) =>
      typeof failure === "string" ? [failure] : failure.url ? [failure.url] : [],
    ),
    usage: tavilyUsage(
      parsed.data.usage?.credits ?? (input.depth === "advanced" ? 2 : 1),
    ),
  });
}
