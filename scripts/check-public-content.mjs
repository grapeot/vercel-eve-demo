import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([
  ".git",
  ".next",
  ".output",
  ".eve",
  ".vercel",
  "node_modules",
  "coverage",
  "generated",
]);
const textExtensions = new Set([
  ".css",
  ".example",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const forbidden = [
  { label: "本机绝对路径", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "1Password 私有引用", pattern: /op:\/\/(?!your-vault)/i },
  { label: "疑似 Tavily key", pattern: /tvly-[A-Za-z0-9_-]{12,}/ },
  { label: "疑似私钥", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "疑似 Vercel token", pattern: /vercel_[A-Za-z0-9_-]{20,}/i },
];

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) continue;
    const path = resolve(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...(await collect(path)));
    else if (textExtensions.has(extname(path)) || entry === ".env.example") files.push(path);
  }
  return files;
}

const failures = [];
for (const path of await collect(root)) {
  const content = await readFile(path, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      failures.push(`${relative(root, path)}: ${rule.label}`);
    }
  }
}

for (const secretFile of [".env", ".env.local", ".env.production", ".env.preview"]) {
  try {
    await stat(resolve(root, secretFile));
    try {
      execFileSync("git", ["check-ignore", "--quiet", secretFile], {
        cwd: root,
        stdio: "ignore",
      });
    } catch {
      failures.push(`${secretFile}: 存在且未被 Git ignore`);
    }
  } catch {
    // Missing is expected.
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Public content scan passed");
