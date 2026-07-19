import type { Client } from "@libsql/client";

import {
  AccessSessionRepository,
  ResearchRepository,
} from "../storage/repositories";
import { getDatabaseClient } from "../storage/server";

interface RuntimeSessionContext {
  session: {
    id: string;
    parent?: { rootSessionId?: string };
    auth: {
      initiator?: { principalId?: string } | null;
      current?: { principalId?: string } | null;
    };
  };
}

export interface RuntimeAuthorization {
  accessSessionId: string;
  runId: string;
  rootSessionId: string;
}

export async function authorizeRuntimeCapability(
  context: RuntimeSessionContext,
  client: Client = getDatabaseClient(),
): Promise<RuntimeAuthorization> {
  const rootSessionId = context.session.parent?.rootSessionId ?? context.session.id;
  const initiatorId = context.session.auth.initiator?.principalId;
  const currentId = context.session.auth.current?.principalId;
  const research = new ResearchRepository(client);
  let runId: string | null = null;

  try {
    const mappedRun = await research.findRunByEveSession(rootSessionId);
    runId = mappedRun ? String(mappedRun.id) : null;
    if (!initiatorId || !currentId || initiatorId !== currentId) {
      throw new Error("Runtime principal mismatch");
    }
    if (!(await new AccessSessionRepository(client).findActive(initiatorId))) {
      throw new Error("Access session is no longer active");
    }
    if (!runId) throw new Error("No Workbench run is mapped to this Eve session");

    const ownedRun = await research.findOwnedRun(runId, initiatorId);
    if (!ownedRun) throw new Error("Workbench run ownership changed");
    if (!["running", "waiting"].includes(String(ownedRun.status))) {
      throw new Error("Workbench run is no longer active");
    }
    return { accessSessionId: initiatorId, runId, rootSessionId };
  } catch {
    if (runId && initiatorId) {
      const ownedRun = await research
        .findOwnedRun(runId, initiatorId)
        .catch(() => null);
      if (ownedRun) {
        await research.advanceRunStatus(runId, "cancelled").catch(() => false);
      }
    }
    throw new Error("Runtime authorization is unavailable or no longer active");
  }
}
