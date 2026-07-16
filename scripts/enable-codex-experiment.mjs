import { chmod, readFile, writeFile } from "node:fs/promises";

const path = ".env.local";
const current = await readFile(path, "utf8");
const name = "CODEX_EXPERIMENT_ENABLED";
const lines = current.trimEnd().split("\n");
const index = lines.findIndex((line) => line.startsWith(`${name}=`));
if (index === -1) lines.push(`${name}=1`);
else lines[index] = `${name}=1`;
await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
await chmod(path, 0o600);
process.stdout.write("Enabled the owner-only Codex compatibility experiment in .env.local.\n");
