import type { Client } from "@libsql/client";

import { createDatabaseClient, resolveDatabaseConfig } from "./client";

const globalDatabase = globalThis as typeof globalThis & {
  researchWorkbenchDatabase?: Client;
};

export function getDatabaseClient(): Client {
  if (!globalDatabase.researchWorkbenchDatabase) {
    globalDatabase.researchWorkbenchDatabase = createDatabaseClient(
      resolveDatabaseConfig(),
    );
  }
  return globalDatabase.researchWorkbenchDatabase;
}
