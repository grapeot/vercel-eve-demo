import { z } from "zod";

export const usageSchema = z.object({
  provider: z.string(),
  operation: z.string(),
  units: z.number().nonnegative(),
  unitName: z.string(),
  reportedCostUsd: z.number().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative(),
  measurement: z.enum(["reported", "estimated"]),
});

export type UsageRecord = z.infer<typeof usageSchema>;

export const TAVILY_PAYG_USD_PER_CREDIT = 0.008;
export const USD_MICROS = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * USD_MICROS);
}

export function tavilyReservationMicros(depth: "basic" | "advanced"): number {
  return usdToMicros((depth === "advanced" ? 2 : 1) * TAVILY_PAYG_USD_PER_CREDIT);
}

export function tavilyUsage(credits: number): UsageRecord {
  const safeCredits = Math.max(0, credits);
  return {
    provider: "tavily",
    operation: "search",
    units: safeCredits,
    unitName: "credit",
    reportedCostUsd: null,
    estimatedCostUsd: Number(
      (safeCredits * TAVILY_PAYG_USD_PER_CREDIT).toFixed(6),
    ),
    measurement: "estimated",
  };
}

export function totalEstimatedCost(records: readonly UsageRecord[]): number {
  return Number(
    records.reduce((total, record) => total + record.estimatedCostUsd, 0).toFixed(6),
  );
}
