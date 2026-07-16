import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const response = await fetch("https://api.ipify.org");
if (!response.ok) throw new Error(`Public IP lookup failed with HTTP ${response.status}`);

const publicIp = (await response.text()).trim();
if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(publicIp)) {
  throw new Error("Public IP lookup did not return an IPv4 address");
}

const values = {
  ACCESS_ALLOWED_CIDRS: `${publicIp}/32,127.0.0.1/32,::1/128`,
  ACCESS_CHALLENGE_SECRET: randomBytes(32).toString("base64url"),
  ACCESS_COOKIE_SIGNING_KEY: randomBytes(32).toString("base64url"),
};

const content = Object.entries(values)
  .map(([name, value]) => `${name}=${value}`)
  .join("\n");

await writeFile(".env.local", `${content}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});

process.stdout.write("Created private .env.local with the current IPv4 /32 and generated access secrets.\n");
