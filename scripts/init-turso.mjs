import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

const platformToken = process.env.TURSO_PLATFORM_TOKEN;
const organization = process.env.TURSO_ORGANIZATION;
const databaseName = process.env.TURSO_DATABASE_NAME ?? "research-workbench-dev";
const groupName = process.env.TURSO_GROUP_NAME ?? "default";
const location = process.env.TURSO_PRIMARY_LOCATION ?? "aws-us-west-2";

if (!platformToken || !organization) {
  throw new Error("TURSO_PLATFORM_TOKEN and TURSO_ORGANIZATION are required");
}

const apiBase = `https://api.turso.tech/v1/organizations/${encodeURIComponent(organization)}`;

async function tursoRequest(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${platformToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

let { response, body: database } = await tursoRequest(
  `/databases/${encodeURIComponent(databaseName)}`,
);

if (response.status === 404) {
  const groupResult = await tursoRequest(`/groups/${encodeURIComponent(groupName)}`);
  if (groupResult.response.status === 404) {
    const createdGroup = await tursoRequest("/groups", {
      method: "POST",
      body: JSON.stringify({ name: groupName, location }),
    });
    if (!createdGroup.response.ok) {
      throw new Error(
        `Turso group provisioning failed with HTTP ${createdGroup.response.status}`,
      );
    }
  } else if (!groupResult.response.ok) {
    throw new Error(
      `Turso group lookup failed with HTTP ${groupResult.response.status}`,
    );
  }
  ({ response, body: database } = await tursoRequest("/databases", {
    method: "POST",
    body: JSON.stringify({ name: databaseName, group: groupName }),
  }));
}

if (!response.ok) {
  throw new Error(`Turso database provisioning failed with HTTP ${response.status}`);
}

database = database.database ?? database;
const hostname = database.Hostname ?? database.hostname;
if (!hostname) throw new Error("Turso response did not include a database hostname");

const tokenResult = await tursoRequest(
  `/databases/${encodeURIComponent(databaseName)}/auth/tokens?authorization=full-access`,
  { method: "POST", body: "{}" },
);
if (!tokenResult.response.ok || !tokenResult.body.jwt) {
  throw new Error(
    `Turso database token creation failed with HTTP ${tokenResult.response.status}`,
  );
}

const envPath = ".env.local";
const current = await readFile(envPath, "utf8").catch((error) => {
  if (error.code === "ENOENT") return "";
  throw error;
});

const updates = new Map([
  ["TURSO_DATABASE_URL", `libsql://${hostname}`],
  ["TURSO_AUTH_TOKEN", tokenResult.body.jwt],
]);
if (!/^CREDENTIAL_ENCRYPTION_KEY=/m.test(current)) {
  updates.set("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64url"));
}

const seen = new Set();
const lines = current
  .trimEnd()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const separator = line.indexOf("=");
    const name = separator === -1 ? line : line.slice(0, separator);
    if (!updates.has(name)) return line;
    seen.add(name);
    return `${name}=${updates.get(name)}`;
  });

for (const [name, value] of updates) {
  if (!seen.has(name)) lines.push(`${name}=${value}`);
}

await writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
await chmod(envPath, 0o600);
process.stdout.write(
  `Configured Turso database ${databaseName} in private .env.local.\n`,
);
