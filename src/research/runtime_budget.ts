import type { RuntimeConfig } from "../config";
import { authorizeRuntimeCapability } from "../security/runtime_authorization";
import { UsageRepository } from "../storage/repositories";
import { getDatabaseClient } from "../storage/server";
import { tavilyReservationMicros, usdToMicros } from "./usage";

interface ToolSessionContext {
  session: {
    id: string;
    parent?: { rootSessionId?: string };
    auth: {
      initiator?: { principalId?: string } | null;
      current?: { principalId?: string } | null;
    };
  };
}

export async function reserveResearchOperation(
  context: ToolSessionContext,
  config: RuntimeConfig,
  depth: "basic" | "advanced",
): Promise<{ runId: string; usage: UsageRepository } | null> {
  if (config.searchBackend === "mock") return null;

  const client = getDatabaseClient();
  const usage = new UsageRepository(client);
  const { runId } = await authorizeRuntimeCapability(context, client);
  const reserved = await usage.reservePaidOperation({
    runId,
    reservationMicrousd: tavilyReservationMicros(depth),
    maxOperations: config.maxSearches,
    budgetMicrousd: usdToMicros(config.budgetUsd),
  });
  if (!reserved) {
    throw new Error("Research budget or Tavily operation limit exhausted");
  }
  return { runId, usage };
}
