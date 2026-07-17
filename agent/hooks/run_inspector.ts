import { defineHook } from "eve/hooks";

import { persistRootEveEvent } from "../../src/events/durability";
import { ResearchRepository } from "../../src/storage/repositories";
import { getDatabaseClient } from "../../src/storage/server";

export default defineHook({
  events: {
    "*": async (event, context) => {
      try {
        await persistRootEveEvent({
          repository: new ResearchRepository(getDatabaseClient()),
          event,
          session: context.session,
        });
      } catch (error) {
        console.warn("Run inspector projection failed", {
          sessionId: context.session.id,
          eventType: event.type,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    },
  },
});
