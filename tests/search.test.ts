import { describe, expect, it, vi } from "vitest";

import { resolveRuntimeConfig } from "@/src/config";
import { executeExtract } from "@/src/research/extract";
import { executeSearch } from "@/src/research/search";

const liveConfig = resolveRuntimeConfig({
  ALLOW_LIVE_API: "1",
  SEARCH_BACKEND: "tavily",
  TAVILY_API_KEY: "replace-with-test-secret",
});

describe("Tavily runtime tools", () => {
  it("mock search returns synthetic sources without calling fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const output = await executeSearch(
      { query: "测试平台无关 skill" },
      resolveRuntimeConfig({}),
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(output.backend).toBe("mock");
    expect(output.sources).toHaveLength(2);
    expect(output.usage.units).toBe(0);
  });

  it("calls Tavily search with answer and raw content disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          query: "Vercel Eve",
          results: [
            {
              title: "Official docs",
              url: "https://docs.example.com/eve",
              content: "Durable agent runtime",
              score: 0.9,
              published_date: "2026-07-16",
            },
            { title: "Bad URL", url: "not-a-url", content: "ignored" },
          ],
          usage: { credits: 2 },
        }),
        { status: 200 },
      ),
    );
    const output = await executeSearch(
      {
        query: "Vercel Eve",
        depth: "advanced",
        maxResults: 3,
        topic: "news",
        includeDomains: ["example.com"],
      },
      liveConfig,
      fetchImpl,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.tavily.com/search");
    expect(body).toMatchObject({
      search_depth: "advanced",
      max_results: 3,
      include_answer: false,
      include_raw_content: false,
      include_domains: ["example.com"],
    });
    expect(output.sources).toHaveLength(1);
    expect(output.sources[0].publishedDate).toBe("2026-07-16");
    expect(output.usage.estimatedCostUsd).toBe(0.016);
    expect(JSON.stringify(output)).not.toContain("test-secret");
  });

  it("normalizes selected Tavily extracts and failed URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://docs.example.com/eve",
              raw_content: "# Eve\n\nDurable sessions.",
            },
          ],
          failed_results: [{ url: "https://example.com/unavailable" }],
          usage: { credits: 2 },
        }),
        { status: 200 },
      ),
    );
    const output = await executeExtract(
      {
        urls: ["https://docs.example.com/eve"],
        query: "durable sessions",
        chunksPerSource: 3,
      },
      liveConfig,
      fetchImpl,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/extract");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      format: "markdown",
      include_images: false,
      query: "durable sessions",
      chunks_per_source: 3,
    });
    expect(output.results[0].content).toContain("Durable sessions");
    expect(output.failedUrls).toEqual(["https://example.com/unavailable"]);
  });

  it("fails closed on invalid JSON without exposing response bodies", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("not-json private diagnostics", { status: 200 }),
    );
    await expect(
      executeSearch({ query: "失败测试" }, liveConfig, fetchImpl),
    ).rejects.toThrow("invalid response");
  });
});
