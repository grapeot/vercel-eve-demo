import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("skill bundle", () => {
  it("ships the research, Tavily, and external-writing contracts", () => {
    const skill = readFileSync(
      resolve(root, "agent/skills/deep-research/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("description:");
    expect(skill).toContain("report.md");
    expect(skill).toContain("API key");
    expect(
      readFileSync(resolve(root, "agent/skills/tavily/SKILL.md"), "utf8"),
    ).toContain("web_extract");
    expect(
      readFileSync(resolve(root, "agent/skills/external-writing/SKILL.md"), "utf8"),
    ).toContain("Three Sequential Passes");
  });

  it("builder 生成固定 commit 与文件 hash 的 lockfile", () => {
    execFileSync(process.execPath, [resolve(root, "scripts/build-skill-bundle.mjs")]);
    const lock = JSON.parse(
      readFileSync(resolve(root, "skills/skills.lock.json"), "utf8"),
    );
    expect(lock.target).toBe("vercel-eve");
    expect(lock.sources).toHaveLength(3);
    expect(lock.sources.every((source: { ref: string }) => source.ref.length === 40)).toBe(
      true,
    );
    expect(lock.installedSkills).toHaveLength(14);
    expect(
      lock.installedSkills.every((item: { sha256: string }) =>
        /^[a-f0-9]{64}$/.test(item.sha256),
      ),
    ).toBe(true);
  });
});
