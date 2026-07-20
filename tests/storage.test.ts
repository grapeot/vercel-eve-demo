import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AccessSessionRepository,
  OAuthAttemptRepository,
  OAuthCredentialRepository,
  OwnerDataRepository,
  ResearchRepository,
  UsageRepository,
} from "@/src/storage/repositories";
import { persistRootEveEvent } from "@/src/events/durability";
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
    expect(result.rows.map((row) => Number(row.version))).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_, index) => index + 1),
    );
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
    expect(await credentials.deleteByOwner("owner")).toBe(true);
    expect(await credentials.findByOwner("owner")).toBeNull();
  });

  it("atomically consumes OAuth attempts when storing or disconnecting credentials", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-oauth-atomic",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const attempts = new OAuthAttemptRepository(client);
    const credentials = new OAuthCredentialRepository(client);
    const attemptId = await attempts.create({
      accessSessionId: "access-oauth-atomic",
      flow: "device",
      stateHash: null,
      encryptedPayload: "encrypted-attempt",
      redirectUri: "https://example.com/callback",
      pollIntervalSeconds: 5,
      nextPollAt: null,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const credential = {
      ownerId: "owner",
      legacyAccessSessionId: null,
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      expiresAt: "2030-01-01T00:00:00.000Z",
      accountId: "account-atomic",
      scope: "openid",
    };

    expect(
      await credentials.upsertFromPendingAttempt({
        attemptId,
        accessSessionId: "access-oauth-atomic",
        credential,
      }),
    ).toBe(true);
    expect(
      await credentials.upsertFromPendingAttempt({
        attemptId,
        accessSessionId: "access-oauth-atomic",
        credential,
      }),
    ).toBe(false);
    expect(await credentials.deleteByOwner("owner")).toBe(true);
    expect(await attempts.findPending(attemptId, "access-oauth-atomic")).toBeNull();

    const revokedAttemptId = await attempts.create({
      accessSessionId: "access-oauth-atomic",
      flow: "device",
      stateHash: null,
      encryptedPayload: "encrypted-revoked-attempt",
      redirectUri: "https://example.com/callback",
      pollIntervalSeconds: 5,
      nextPollAt: null,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    await credentials.deleteByOwner("owner");
    expect(
      await credentials.upsertFromPendingAttempt({
        attemptId: revokedAttemptId,
        accessSessionId: "access-oauth-atomic",
        credential,
      }),
    ).toBe(false);
    expect(await credentials.findByOwner("owner")).toBeNull();
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

    const projectedInput = {
      runId,
      sourceSessionId: "eve-session-1",
      sourceEventKey: "event-key-1",
      sourceCreatedAt: "2026-07-17T12:00:00.000Z",
      type: "session.waiting",
      summary: "Waiting",
      runStatus: "waiting" as const,
    };
    expect(await research.appendProjectedEvent(projectedInput)).toBe(true);
    expect(await research.appendProjectedEvent(projectedInput)).toBe(false);
    expect(
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          research.appendProjectedEvent({
            ...projectedInput,
            sourceEventKey: `concurrent-${index}`,
            sourceCreatedAt: `2026-07-17T12:00:0${index + 1}.000Z`,
            type: "tool.completed",
            summary: `Completed ${index}`,
            runStatus: "running",
          }),
        ),
      ),
    ).toEqual(Array(8).fill(true));
    const projectedEvents = await research.listEvents(runId);
    expect(new Set(projectedEvents.map((event) => event.sequence)).size).toBe(
      projectedEvents.length,
    );
    await research.appendProjectedEvent({
      ...projectedInput,
      sourceEventKey: "failed-event",
      sourceCreatedAt: "2026-07-17T12:01:00.000Z",
      type: "turn.failed",
      summary: "Failed",
      runStatus: "failed",
    });
    await research.appendProjectedEvent({
      ...projectedInput,
      sourceEventKey: "late-running-event",
      sourceCreatedAt: "2026-07-17T12:02:00.000Z",
      type: "turn.started",
      summary: "Late start",
      runStatus: "running",
    });
    expect(await research.findRunByEveSession("eve-session-1")).toMatchObject({
      status: "failed",
    });

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

  it("fails only queued runs that never attached to an Eve session", async () => {
    const sessions = new AccessSessionRepository(client);
    await sessions.create({
      id: "access-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-1",
      question: "Will startup fail safely?",
    });
    const failedRunId = await research.createRun({
      requestId,
      workspaceId: "workspace-failed",
      skillBundleVersion: "bundle-v1",
    });

    expect(await research.failUnattachedRun(failedRunId)).toBe(true);
    expect(await research.failUnattachedRun(failedRunId)).toBe(false);

    const attachedRunId = await research.createRun({
      requestId,
      workspaceId: "workspace-attached",
      skillBundleVersion: "bundle-v1",
    });
    await research.attachSession({
      runId: attachedRunId,
      accessSessionId: "access-1",
      eveSessionId: "eve-session-attached",
    });
    expect(await research.failUnattachedRun(attachedRunId)).toBe(false);
  });

  it("hard-deletes an owned run and all product children", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-delete",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-delete",
      question: "Can this run be erased?",
    });
    const runId = await research.createRun({
      requestId,
      workspaceId: "workspace-delete",
      skillBundleVersion: "bundle-v1",
    });
    await research.appendEvent({
      runId,
      sequence: 0,
      type: "session.started",
      summary: "Started",
    });
    await research.storeArtifact({
      runId,
      path: "report.md",
      mediaType: "text/markdown",
      content: "# Delete me",
    });

    expect(await research.hardDeleteOwnedRun(runId, "other-owner")).toBe(false);
    expect(await research.hardDeleteOwnedRun(runId, "access-delete")).toBe(true);
    for (const table of [
      "research_requests",
      "runs",
      "run_events",
      "artifacts",
      "feedback",
      "usage_summaries",
    ]) {
      const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
      expect(Number(result.rows[0].count)).toBe(0);
    }
  });

  it("prevents late events from a deleted Eve session hijacking the next run", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-retired-session",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const firstRequestId = await research.createRequest({
      accessSessionId: "access-retired-session",
      question: "First run",
    });
    const firstRunId = await research.createRun({
      requestId: firstRequestId,
      workspaceId: "workspace-retired-first",
      skillBundleVersion: "bundle-v1",
    });
    await research.attachSession({
      runId: firstRunId,
      accessSessionId: "access-retired-session",
      eveSessionId: "eve-retired-session",
    });
    await research.hardDeleteOwnedRun(firstRunId, "access-retired-session");

    const secondRequestId = await research.createRequest({
      accessSessionId: "access-retired-session",
      question: "Second run",
    });
    const secondRunId = await research.createRun({
      requestId: secondRequestId,
      workspaceId: "workspace-retired-second",
      skillBundleVersion: "bundle-v1",
    });
    expect(
      await research.attachSession({
        runId: secondRunId,
        accessSessionId: "access-retired-session",
        eveSessionId: "eve-retired-session",
      }),
    ).toBe(false);
    const lateEvent = await persistRootEveEvent({
      repository: research,
      session: {
        id: "eve-retired-session",
        auth: {
          initiator: { principalId: "access-retired-session" },
          current: { principalId: "access-retired-session" },
        },
      },
      event: { type: "turn.started", data: { turnId: "late-turn" } },
    });

    expect(lateEvent).toBe(false);
    expect(await research.findRunByEveSession("eve-retired-session")).toBeNull();
    expect(await research.findOwnedRun(secondRunId, "access-retired-session")).toMatchObject({
      status: "queued",
      eve_session_id: null,
    });
  });

  it("purges all owner data while preserving the migration ledger", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-purge",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-purge",
      question: "Can all owner data be erased?",
    });
    await research.createRun({
      requestId,
      workspaceId: "workspace-purge",
      skillBundleVersion: "bundle-v1",
    });
    await client.execute(
      "INSERT INTO retired_eve_sessions (eve_session_id, retired_at) VALUES ('purge-tombstone', '2026-07-17T00:00:00.000Z')",
    );

    await new OwnerDataRepository(client).purgeAll();
    for (const table of [
      "access_sessions",
      "oauth_attempts",
      "oauth_credentials",
      "research_requests",
      "runs",
      "run_events",
      "artifacts",
      "feedback",
      "usage_summaries",
      "skill_bundle_versions",
      "retired_eve_sessions",
    ]) {
      const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
      expect(Number(result.rows[0].count)).toBe(0);
    }
    const migrations = await client.execute(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );
    expect(Number(migrations.rows[0].count)).toBe(SCHEMA_VERSION);
  });

  it("upgrades an existing v5 database and cancels active runs in v7", async () => {
    const legacyClient = createClient({ url: ":memory:" });
    try {
      await migrateDatabase(legacyClient);
      await legacyClient.execute("DELETE FROM schema_migrations WHERE version >= 6");
      await legacyClient.execute("DROP TABLE retired_eve_sessions");

      await new AccessSessionRepository(legacyClient).create({
        id: "access-v5-upgrade",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
      const legacyResearch = new ResearchRepository(legacyClient);
      const requestId = await legacyResearch.createRequest({
        accessSessionId: "access-v5-upgrade",
        question: "Will migration cancel this active run?",
      });
      const runId = await legacyResearch.createRun({
        requestId,
        workspaceId: "workspace-v5-upgrade",
        skillBundleVersion: "bundle-v1",
      });
      await legacyClient.execute({
        sql: "UPDATE runs SET status = 'running', eve_session_id = ? WHERE id = ?",
        args: ["eve-v5-upgrade", runId],
      });

      await migrateDatabase(legacyClient);
      expect(await legacyResearch.findRunByEveSession("eve-v5-upgrade")).toMatchObject({
        status: "cancelled",
      });
      const versions = await legacyClient.execute(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      expect(versions.rows.map((row) => Number(row.version))).toEqual(
        Array.from({ length: SCHEMA_VERSION }, (_, index) => index + 1),
      );
    } finally {
      legacyClient.close();
    }
  });

  it("atomically enforces paid operation and micro-USD run budgets", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-budget",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-budget",
      question: "Will concurrent calls stay inside budget?",
    });
    const runId = await research.createRun({
      requestId,
      workspaceId: "workspace-budget",
      skillBundleVersion: "bundle-v1",
    });
    const usage = new UsageRepository(client);

    const reservations = await Promise.all(
      Array.from({ length: 8 }, () =>
        usage.reservePaidOperation({
          runId,
          reservationMicrousd: 8_000,
          maxOperations: 5,
          budgetMicrousd: 24_000,
        }),
      ),
    );
    expect(reservations.filter(Boolean)).toHaveLength(3);
    await usage.recordEstimatedCost(runId, 0.008);
    expect(await usage.find(runId)).toEqual({
      searchCount: 3,
      reservedCostMicrousd: 24_000,
      estimatedCostUsd: 0.008,
    });

    const operationLimitedRunId = await research.createRun({
      requestId,
      workspaceId: "workspace-operation-limit",
      skillBundleVersion: "bundle-v1",
    });
    const operationLimitResults = await Promise.all(
      Array.from({ length: 4 }, () =>
        usage.reservePaidOperation({
          runId: operationLimitedRunId,
          reservationMicrousd: 8_000,
          maxOperations: 2,
          budgetMicrousd: 100_000,
        }),
      ),
    );
    expect(operationLimitResults.filter(Boolean)).toHaveLength(2);
  });

  it("persists root hook events without a browser collector", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-hook",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-hook",
      question: "Does the hook persist events?",
    });
    const runId = await research.createRun({
      requestId,
      workspaceId: "workspace-hook",
      skillBundleVersion: "bundle-v1",
    });
    const session = {
      id: "eve-hook-session",
      auth: {
        initiator: { principalId: "access-hook" },
        current: { principalId: "access-hook" },
      },
    };

    expect(
      await persistRootEveEvent({
        repository: research,
        session,
        event: {
          type: "session.started",
          data: {},
          meta: { at: "2026-07-17T12:00:00.000Z" },
        },
      }),
    ).toBe(true);
    expect(await research.findRunByEveSession("eve-hook-session")).toMatchObject({
      id: runId,
      status: "running",
    });
    expect(await research.listEvents(runId)).toEqual([
      expect.objectContaining({
        sourceSessionId: "eve-hook-session",
        type: "session.started",
      }),
    ]);
  });

  it("recovers a missed session mapping from the first later root event", async () => {
    await new AccessSessionRepository(client).create({
      id: "access-hook-recovery",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const research = new ResearchRepository(client);
    const requestId = await research.createRequest({
      accessSessionId: "access-hook-recovery",
      question: "Can a later event recover the mapping?",
    });
    const runId = await research.createRun({
      requestId,
      workspaceId: "workspace-hook-recovery",
      skillBundleVersion: "bundle-v1",
    });

    expect(
      await persistRootEveEvent({
        repository: research,
        session: {
          id: "eve-hook-recovery-session",
          auth: {
            initiator: { principalId: "access-hook-recovery" },
            current: { principalId: "access-hook-recovery" },
          },
        },
        event: {
          type: "turn.started",
          data: { sequence: 1, turnId: "turn-recovery" },
        },
      }),
    ).toBe(true);
    expect(await research.findRunByEveSession("eve-hook-recovery-session")).toMatchObject({
      id: runId,
      status: "running",
    });
    expect(await research.listEvents(runId)).toEqual([
      expect.objectContaining({ type: "turn.started" }),
    ]);
  });
});
