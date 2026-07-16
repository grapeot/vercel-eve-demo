import { describe, expect, it } from "vitest";

import {
  tavilyUsage,
  totalEstimatedCost,
} from "@/src/research/usage";

describe("usage", () => {
  it("按 PAYG 价格估算 Tavily credits", () => {
    expect(tavilyUsage(24)).toMatchObject({
      units: 24,
      unitName: "credit",
      estimatedCostUsd: 0.192,
      measurement: "estimated",
    });
  });

  it("聚合成本时保持固定精度", () => {
    expect(totalEstimatedCost([tavilyUsage(2), tavilyUsage(1)])).toBe(0.024);
  });

  it("负数 credits 不会形成负成本", () => {
    expect(tavilyUsage(-3).estimatedCostUsd).toBe(0);
  });
});
