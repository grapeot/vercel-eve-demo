import { OwnerDataRepository } from "../src/storage/repositories";
import { getDatabaseClient } from "../src/storage/server";

const args = new Set(process.argv.slice(2));
const confirmation = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const ownerDataTarget = args.has("--owner-data");
const platformTarget = args.has("--platform");

if (ownerDataTarget === platformTarget) {
  throw new Error("Choose exactly one teardown target: --owner-data or --platform");
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function expectDeleted(response: Response, service: string): Promise<void> {
  if (response.ok || response.status === 404) return;
  throw new Error(`${service} teardown failed with HTTP ${response.status}`);
}

if (ownerDataTarget) {
  if (confirmation !== "PURGE OWNER DATA") {
    throw new Error('Owner purge requires --confirm="PURGE OWNER DATA"');
  }
  const client = getDatabaseClient();
  try {
    await new OwnerDataRepository(client).purgeAll();
  } finally {
    client.close();
  }
  process.stdout.write("Purged owner data. External platform resources were not deleted.\n");
} else if (platformTarget) {
  const vercelToken = requireEnvironment("VERCEL_TOKEN");
  const vercelProjectId = requireEnvironment("VERCEL_PROJECT_ID");
  const vercelTeamId = process.env.VERCEL_TEAM_ID;
  const tursoToken = requireEnvironment("TURSO_PLATFORM_TOKEN");
  const tursoOrganization = requireEnvironment("TURSO_ORGANIZATION");
  const tursoDatabase = requireEnvironment("TURSO_DATABASE_NAME");
  const expected = `DELETE ${vercelProjectId} AND ${tursoOrganization}/${tursoDatabase}`;
  if (confirmation !== expected) {
    throw new Error(`Platform teardown requires --confirm="${expected}"`);
  }

  const projectUrl = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}`,
  );
  if (vercelTeamId) projectUrl.searchParams.set("teamId", vercelTeamId);
  await expectDeleted(
    await fetch(projectUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${vercelToken}` },
    }),
    "Vercel project",
  );

  const databaseUrl =
    `https://api.turso.tech/v1/organizations/${encodeURIComponent(tursoOrganization)}` +
    `/databases/${encodeURIComponent(tursoDatabase)}`;
  await expectDeleted(
    await fetch(databaseUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tursoToken}` },
    }),
    "Turso database",
  );
  process.stdout.write(
    "Deleted the Vercel project and Turso database. Complete provider revocation checks in docs/teardown.md.\n",
  );
}
