import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "skills/bundle.json");
const lockPath = resolve(root, "skills/skills.lock.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills)) {
  throw new Error("skills/bundle.json schema 无效");
}

const ids = new Set();
for (const skill of manifest.skills) {
  if (!skill.id || ids.has(skill.id)) throw new Error(`重复或无效 skill id：${skill.id}`);
  if (!/^[a-f0-9]{40}$/.test(skill.ref)) throw new Error(`${skill.id} 必须 pin 40 位 commit`);
  if (!skill.source?.startsWith("https://github.com/")) {
    throw new Error(`${skill.id} source 必须是公开 GitHub HTTPS URL`);
  }
  ids.add(skill.id);
}

const localSkills = [];
for (const skill of manifest.skills) {
  const paths = skill.installedPaths ?? (skill.installedPath ? [skill.installedPath] : []);
  for (const path of paths) {
    const content = await readFile(resolve(root, path));
    localSkills.push({
      id: skill.id,
      installedPath: path,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
}

const lock = {
  schemaVersion: 1,
  bundle: manifest.bundle,
  target: manifest.target,
  sources: manifest.skills.map((skill) => ({
    id: skill.id,
    type: skill.type,
    source: skill.source,
    ref: skill.ref,
    rootSkill: skill.rootSkill ?? skill.canonicalPath,
    install: skill.install ?? null,
    commands: skill.commands ?? [],
    credentials: skill.credentials ?? [],
    networkAllow: skill.networkAllow ?? [],
  })),
  installedSkills: localSkills,
};

await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
console.log(`Skill bundle lock 已生成：${lockPath}`);
