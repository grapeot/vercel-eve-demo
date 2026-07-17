import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AccessSessionRepository,
  OAuthAttemptRepository,
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
    expect(result.rows.map((row) => Number(row.version))).toEqual([1, 2, SCHEMA_VERSION]);
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
      ownerId: "owner",
      legacyAccessSessionId: null,
      encryptedAccessToken: "encrypted-access-1",
      encryptedRefreshToken: "encrypted-refresh-1",
      expiresAt: "2026-07-16T13:00:00.000Z",
      accountId: "account-1",
      scope: "openid",
    });

    expect(first.version).toBe(1);
    expect(
      await credentials.rotateIfVersion("owner", 1, {
        encryptedAccessToken: "encrypted-access-2",
        encryptedRefreshToken: "encrypted-refresh-2",
        expiresAt: "2026-07-16T14:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      await credentials.rotateIfVersion("owner", 1, {
        encryptedAccessToken: "stale-write",
        encryptedRefreshToken: null,
        expiresAt: "2026-07-16T15:00:00.000Z",
      }),
    ).toBe(false);
    expect((await credentials.findByOwner("owner"))?.version).toBe(2);
  });

  it("rate-limits device polling with an atomic next-poll claim", async () => {
    const sessions = new AccessSessionRepository(client);
    await sessions.create({
      id: "access-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const attempts = new OAuthAttemptRepository(client);
    await attempts.create({
      id: "attempt-1",
      accessSessionId: "access-1",
      flow: "device",
      stateHash: null,
      encryptedPayload: "encrypted",
      redirectUri: "https://example.com/callback",
      pollIntervalSeconds: 5,
      nextPollAt: "2026-07-16T12:00:00.000Z",
      expiresAt: "2026-07-16T12:10:00.000Z",
    });
    expect(
      await attempts.claimDevicePoll({
        id: "attempt-1",
        accessSessionId: "access-1",
        now: "2026-07-16T12:00:00.000Z",
        nextPollAt: "2026-07-16T12:00:05.000Z",
      }),
    ).toBe(true);
    expect(
      await attempts.claimDevicePoll({
        id: "attempt-1",
        accessSessionId: "access-1",
        now: "2026-07-16T12:00:01.000Z",
        nextPollAt: "2026-07-16T12:00:06.000Z",
      }),
    ).toBe(false);
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
    expect(
      await research.attachQueuedSession({
        accessSessionId: "another-owner",
        eveSessionId: "eve-session-1",
      }),
    ).toBe(false);
    expect(
      await research.attachQueuedSession({
        accessSessionId: "access-1",
        eveSessionId: "eve-session-1",
      }),
    ).toBe(true);
    expect(
      await research.attachQueuedSession({
        accessSessionId: "access-1",
        eveSessionId: "eve-session-2",
      }),
    ).toBe(false);
    expect(
      await research.attachSession({
        runId,
        accessSessionId: "access-1",
        eveSessionId: "eve-session-1",
      }),
    ).toBe(true);
    expect(await research.findRunByEveSession("eve-session-1")).toMatchObject({
      id: runId,
      status: "running",
    });
    await research.appendEvent({
      runId,
      sequence: 1,
      type: "session.started",
      summary: "Research started",
    });
    await research.appendEvent({
      runId,
      sequence: 1,
      type: "duplicate",
      summary: "Duplicate cursor",
    });
    expect(await research.listEvents(runId)).toHaveLength(1);

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
    expect(await research.listArtifacts(runId)).toEqual([
      expect.objectContaining({ id: second.id, path: "report.md" }),
    ]);
    expect(await research.findArtifact(runId, first.id)).toMatchObject({
      content: "# First",
    });
  });
});
