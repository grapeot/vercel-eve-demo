import { createClient, type Client } from "@libsql/client";

export interface DatabaseConfig {
  url: string;
  authToken?: string;
}

export function createDatabaseClient(config: DatabaseConfig): Client {
  return createClient({ url: config.url, authToken: config.authToken });
}

export function resolveDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfig {
  if (!env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is required");
  }
  if (env.TURSO_DATABASE_URL.startsWith("libsql://") && !env.TURSO_AUTH_TOKEN) {
    throw new Error("Remote Turso databases require TURSO_AUTH_TOKEN");
  }
  return {
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  };
}
