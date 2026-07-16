import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AccessSessionRepository,
  OAuthCredentialRepository,
  ResearchRepository,
} from "@/src/storage/repositories";
import { migrateDatabase, SCHEMA_VERSION } from "@/src/storage/schema";

describe("Turso storage", () => {
  let client: ReturnType<typeof createClient>;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await migrateDatabase(client);
  });

  afterEach(() => client.close());

  it("applies the schema idempotently", async () => {
    await migrateDatabase(client);
    const result = await client.execute(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(result.rows.map((row) => Number(row.version))).toEqual([SCHEMA_VERSION]);
  });

  it("creates, validates, hashes metadata, and revokes access sessions", async () => {
    const repository = new AccessSessionRepository(client);
    const session = await repository.create({
      id: "access-1",
      expiresAt: "2026-07-17T00:00:00.000Z",
      clientIp: "192.0.2.10",
      userAgent: "test-browser",
    });

    expect(
      await repository.findActive("access-1", new Date("2026-07-16T00:00:00.000Z")),
    ).toEqual(session);
    const stored = await client.execute(
      "SELECT client_ip_hash, user_agent_hash FROM access_sessions WHERE id = 'access-1'",
    );
    expect(String(stored.rows[0].client_ip_hash)).not.toContain("192.0.2.10");
    expect(await repository.revoke("access-1")).toBe(true);
    expect(await repository.findActive("access-1")).toBeNull();
  });

  it("upserts credentials and guards refresh rotation with a version CAS", async () => {
    const sessions = new AccessSessionRepository(client);
    await sessions.create({
      id: "access-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const credentials = new OAuthCredentialRepository(client);
    const first = await credentials.upsert({
      accessSessionId: "access-1",
      encryptedAccessToken: "encrypted-access-1",
      encryptedRefreshToken: "encrypted-refresh-1",
      expiresAt: "2026-07-16T13:00:00.000Z",
      accountId: "account-1",
      scope: "openid",
    });

    expect(first.version).toBe(1);
    expect(
      await credentials.rotateIfVersion("access-1", 1, {
        encryptedAccessToken: "encrypted-access-2",
        encryptedRefreshToken: "encrypted-refresh-2",
        expiresAt: "2026-07-16T14:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      await credentials.rotateIfVersion("access-1", 1, {
        encryptedAccessToken: "stale-write",
        encryptedRefreshToken: null,
        expiresAt: "2026-07-16T15:00:00.000Z",
      }),
    ).toBe(false);
    expect((await credentials.findBySession("access-1"))?.version).toBe(2);
  });

  it("stores run events, immutable artifact revisions, and anchored feedback", async () => {
    const sessions = new AccessSessionRepository(client);
    await sessions.create({
      id: "access-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-1",
      question: "What changed?",
      constraints: { maxSources: 6 },
    });
    const runId = await research.createRun({
      requestId,
      workspaceId: "workspace-1",
      skillBundleVersion: "bundle-v1",
    });
    await research.appendEvent({
      runId,
      sequence: 1,
      type: "session.started",
      summary: "Research started",
    });
    await expect(
      research.appendEvent({
        runId,
        sequence: 1,
        type: "duplicate",
        summary: "Duplicate cursor",
      }),
    ).rejects.toThrow();

    const first = await research.storeArtifact({
      runId,
      path: "report.md",
      mediaType: "text/markdown",
      content: "# First",
    });
    const second = await research.storeArtifact({
      runId,
      path: "report.md",
      mediaType: "text/markdown",
      content: "# Revised",
      parentArtifactId: first.id,
    });
    await research.addFeedback({
      runId,
      artifactId: second.id,
      reportContentHash: second.contentHash,
      selectedText: "Revised",
      feedbackText: "Add evidence.",
    });

    const latest = await research.findLatestArtifact(runId, "report.md");
    expect(latest?.content).toBe("# Revised");
    expect(latest?.parent_artifact_id).toBe(first.id);
  });
});
