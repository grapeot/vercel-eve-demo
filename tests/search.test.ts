import { describe, expect, it, vi } from "vitest";

import { resolveRuntimeConfig } from "@/src/config";
import { executeSearch } from "@/src/research/search";

describe("executeSearch", () => {
  it("mock 后端返回合成来源且不调用 fetch", async () => {
    const runCli = vi.fn();
    const output = await executeSearch(
      { query: "测试平台无关 skill" },
      resolveRuntimeConfig({}),
      runCli,
    );
    expect(runCli).not.toHaveBeenCalled();
    expect(output.backend).toBe("mock");
    expect(output.sources).toHaveLength(2);
    expect(output.sources.every((source) => source.url.includes("example"))).toBe(true);
    expect(output.usage.units).toBe(0);
  });

  it("Tavily 后端规范化 CLI envelope", async () => {
    const runCli = vi.fn().mockResolvedValue(
      JSON.stringify({
        command: "search",
        data: {
          query: "Vercel eve",
          results: [
            {
              title: "Official docs",
              url: "https://docs.example.com/eve",
              content: "Durable agent runtime",
              score: 0.9,
            },
            { title: "Bad URL", url: "not-a-url", content: "ignored" },
          ],
          usage: { credits: 2 },
        },
      }),
    );
    const config = resolveRuntimeConfig({
      ALLOW_LIVE_API: "1",
      SEARCH_BACKEND: "tavily",
      TAVILY_API_KEY: "replace-with-test-secret",
      TAVILY_PROJECT: "project-example",
    });

    const output = await executeSearch(
      { query: "Vercel eve", depth: "advanced", maxResults: 3 },
      config,
      runCli,
    );

    expect(output.sources).toHaveLength(1);
    expect(output.usage.estimatedCostUsd).toBe(0.016);
    expect(runCli).toHaveBeenCalledWith({
      query: "Vercel eve",
      depth: "advanced",
      maxResults: 3,
    });
    expect(JSON.stringify(output)).not.toContain("test-secret");
  });

  it("CLI 非 JSON 输出不进入结果", async () => {
    const config = resolveRuntimeConfig({
      ALLOW_LIVE_API: "1",
      SEARCH_BACKEND: "tavily",
      TAVILY_API_KEY: "replace-with-test-secret",
    });
    const runCli = vi.fn().mockResolvedValue("not-json");
    await expect(
      executeSearch({ query: "失败测试" }, config, runCli),
    ).rejects.toThrow("Tavily CLI 返回无效 JSON");
  });
});
