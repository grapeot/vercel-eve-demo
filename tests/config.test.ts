import { describe, expect, it } from "vitest";

import { publicRuntimeConfig, resolveRuntimeConfig } from "@/src/config";

describe("resolveRuntimeConfig", () => {
  it("默认使用完全离线的 mock 模式", () => {
    const config = resolveRuntimeConfig({});
    expect(config).toMatchObject({
      mode: "mock",
      searchBackend: "mock",
      allowLiveApi: false,
      budgetUsd: 2,
      maxSearches: 10,
    });
  });

  it("live 模式缺少显式开关时失败", () => {
    expect(() => resolveRuntimeConfig({ EVE_DEMO_MODE: "live" })).toThrow(
      "ALLOW_LIVE_API=1",
    );
  });

  it("Tavily 后端缺少 key 时失败", () => {
    expect(() =>
      resolveRuntimeConfig({ SEARCH_BACKEND: "tavily", ALLOW_LIVE_API: "1" }),
    ).toThrow("TAVILY_API_KEY");
  });

  it("公开配置不泄漏 key", () => {
    const config = resolveRuntimeConfig({
      EVE_DEMO_MODE: "live",
      SEARCH_BACKEND: "tavily",
      ALLOW_LIVE_API: "1",
      TAVILY_API_KEY: "replace-with-a-test-only-secret",
    });
    const visible = JSON.stringify(publicRuntimeConfig(config));
    expect(visible).not.toContain("test-only-secret");
    expect(visible).toContain('"credentialConfigured":true');
  });
});
