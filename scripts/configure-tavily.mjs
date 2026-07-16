import { chmod, readFile, writeFile } from "node:fs/promises";

if (!process.env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is required");

const path = ".env.local";
const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
const updates = new Map([
  ["TAVILY_API_KEY", process.env.TAVILY_API_KEY],
  ["SEARCH_BACKEND", "tavily"],
  ["ALLOW_LIVE_API", "1"],
]);
for (const [name, value] of updates) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index === -1) lines.push(`${name}=${value}`);
  else lines[index] = `${name}=${value}`;
}
await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
await chmod(path, 0o600);
process.stdout.write("Configured app-runtime Tavily access in private .env.local.\n");
