import type { RuntimeConfig } from "../config";
import { ResearchRepository, UsageRepository } from "../storage/repositories";
import { getDatabaseClient } from "../storage/server";
import { tavilyReservationMicros, usdToMicros } from "./usage";

interface ToolSessionContext {
  session: {
    id: string;
    parent?: { rootSessionId?: string };
  };
}

export async function reserveResearchOperation(
  context: ToolSessionContext,
  config: RuntimeConfig,
  depth: "basic" | "advanced",
): Promise<{ runId: string; usage: UsageRepository } | null> {
  if (config.searchBackend === "mock") return null;

  const client = getDatabaseClient();
  const research = new ResearchRepository(client);
  const usage = new UsageRepository(client);
  const rootSessionId = context.session.parent?.rootSessionId ?? context.session.id;
  const run = await research.findRunByEveSession(rootSessionId);
  if (!run) throw new Error("No Workbench run is mapped to this Eve session");

  const runId = String(run.id);
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
