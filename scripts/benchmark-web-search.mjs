import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { generateText, gateway } from "ai";

const QUERIES = [
  {
    id: "official-product",
    category: "官方产品文档",
    query: "Vercel Eve built-in web_search backend pricing 2026",
  },
  {
    id: "niche-github",
    category: "边缘工程问题",
    query: "microsandbox 0.5.10 network policy transform Authorization header",
  },
  {
    id: "technical-limits",
    category: "技术限制",
    query: "Cloudflare Durable Objects SQLite point-in-time recovery limits 2026",
  },
  {
    id: "security-advisory",
    category: "安全公告",
    query: "Next.js GHSA-qx2v-qp2m-jg93 patched version",
  },
  {
    id: "academic",
    category: "学术论文",
    query: "test-time scaling verifier reward hacking 2025 paper arXiv",
  },
  {
    id: "financial-primary",
    category: "公司一手数据",
    query: "NVIDIA FY2026 10-K data center revenue official",
  },
  {
    id: "chinese-freshness",
    category: "中文时效信息",
    query: "2026年中国具身智能机器人融资 官方公告",
  },
  {
    id: "local-official",
    category: "本地公共信息",
    query: "Mercer Island light rail station opening date official Sound Transit",
  },
  {
    id: "entity-discovery",
    category: "新实体定位",
    query: "Eve agent framework filesystem-first Vercel",
  },
  {
    id: "product-transition",
    category: "产品迁移历史",
    query: "Neon Vercel Postgres transition Marketplace official documentation",
  },
];

const MAX_RESULTS = 6;
const MODEL = process.env.BENCHMARK_MODEL || "openai/gpt-5.4-mini";
const QUERY_DELAY_MS = Number(process.env.BENCHMARK_QUERY_DELAY_MS || "15000");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function capture(operation) {
  const startedAt = performance.now();
  try {
    return {
      value: await operation(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message.slice(0, 500) : String(error),
      },
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function searchTavily(query) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("TAVILY_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  });
  if (!response.ok) throw new Error(`Tavily returned HTTP ${response.status}`);

  const payload = await response.json();
  return {
    query: payload.query ?? query,
    results: (payload.results ?? []).map((result) => ({
      url: result.url,
      title: result.title,
      excerpt: result.content ?? "",
      score: typeof result.score === "number" ? result.score : null,
      publishDate: result.published_date ?? null,
    })),
    usage: payload.usage ?? null,
  };
}

async function searchParallel(query) {
  requireEnv("AI_GATEWAY_API_KEY");
  const result = await generateText({
    model: MODEL,
    temperature: 0,
    maxOutputTokens: 512,
    prompt: [
      "Call parallel_search exactly once.",
      `Set objective to exactly ${JSON.stringify(query)}.`,
      `Set search_queries to an array containing only ${JSON.stringify(query)}.`,
      `Set max_results to ${MAX_RESULTS}.`,
      "Do not answer or summarize the query.",
    ].join(" "),
    tools: {
      parallel_search: gateway.tools.parallelSearch({
        mode: "one-shot",
        maxResults: MAX_RESULTS,
        excerpts: {
          maxCharsPerResult: 1_000,
          maxCharsTotal: 6_000,
        },
      }),
    },
    toolChoice: { type: "tool", toolName: "parallel_search" },
  });

  const toolCall = result.toolCalls.find((call) => call.toolName === "parallel_search");
  const toolResult = result.toolResults.find(
    (candidate) => candidate.toolName === "parallel_search",
  );
  if (!toolCall || !toolResult || !("output" in toolResult)) {
    throw new Error("Parallel Search did not return a tool result");
  }

  const output = toolResult.output;
  if (!output || typeof output !== "object" || !("results" in output)) {
    throw new Error("Parallel Search returned an invalid result envelope");
  }

  return {
    input: toolCall.input,
    results: output.results,
    usage: output.usage ?? null,
    modelUsage: result.usage,
  };
}

async function runQuery(queryDefinition) {
  process.stdout.write(`Running ${queryDefinition.id}...\n`);
  const [parallel, tavily] = await Promise.all([
    capture(() => searchParallel(queryDefinition.query)),
    capture(() => searchTavily(queryDefinition.query)),
  ]);
  return {
    ...queryDefinition,
    parallel: {
      latencyMs: parallel.latencyMs,
      ...(parallel.value ?? { error: parallel.error }),
    },
    tavily: {
      latencyMs: tavily.latencyMs,
      ...(tavily.value ?? { error: tavily.error }),
    },
  };
}

const startedAt = new Date();
const results = [];
await mkdir("tmp", { recursive: true });
const outputPath = `tmp/web-search-benchmark-${startedAt.toISOString().replaceAll(":", "-")}.json`;

function artifact() {
  return {
    generatedAt: new Date().toISOString(),
  configuration: {
    parallel: {
      provider: "Parallel Search through Vercel AI Gateway",
      model: MODEL,
      mode: "one-shot",
      maxResults: MAX_RESULTS,
      answerGeneration: false,
    },
    tavily: {
      provider: "Tavily Search API",
      searchDepth: "advanced",
      maxResults: MAX_RESULTS,
      includeAnswer: false,
      includeRawContent: false,
    },
  },
  durationMs: Date.now() - startedAt.getTime(),
  results,
  };
}

async function saveArtifact() {
  await writeFile(outputPath, `${JSON.stringify(artifact(), null, 2)}\n`, "utf8");
}

for (const [index, query] of QUERIES.entries()) {
  results.push(await runQuery(query));
  await saveArtifact();
  if (index < QUERIES.length - 1) await sleep(QUERY_DELAY_MS);
}
process.stdout.write(`${outputPath}\n`);
