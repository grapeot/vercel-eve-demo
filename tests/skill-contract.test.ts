import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("skill bundle", () => {
  it("deep-research skill 声明来源、预算、引用与 secret 边界", () => {
    const skill = readFileSync(
      resolve(root, "agent/skills/deep-research/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("description:");
    expect(skill).toContain("来源 URL");
    expect(skill).toContain("成本边界");
    expect(skill).toContain("API key");
  });

  it("builder 生成固定 commit 与文件 hash 的 lockfile", () => {
    execFileSync(process.execPath, [resolve(root, "scripts/build-skill-bundle.mjs")]);
    const lock = JSON.parse(
      readFileSync(resolve(root, "skills/skills.lock.json"), "utf8"),
    );
    expect(lock.target).toBe("vercel-eve");
    expect(lock.sources).toHaveLength(2);
    expect(lock.sources.every((source: { ref: string }) => source.ref.length === 40)).toBe(
      true,
    );
    expect(lock.installedSkills[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
