import { createDatabaseClient, resolveDatabaseConfig } from "../src/storage/client";
import { migrateDatabase, SCHEMA_VERSION } from "../src/storage/schema";

const client = createDatabaseClient(resolveDatabaseConfig());
try {
  await migrateDatabase(client);
  process.stdout.write(`Database schema is at version ${SCHEMA_VERSION}.\n`);
} finally {
  client.close();
}
