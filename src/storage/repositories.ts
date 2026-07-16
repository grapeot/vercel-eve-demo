import { createHash, randomUUID } from "node:crypto";

import type { Client, InValue } from "@libsql/client";

function nowIso(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function rowString(value: InValue | undefined): string | null {
  return value == null ? null : String(value);
}

export function hashPrivateMetadata(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export interface AccessSession {
  id: string;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

export class AccessSessionRepository {
  constructor(private readonly client: Client) {}

  async create(input: {
    id?: string;
    expiresAt: string;
    clientIp?: string;
    userAgent?: string;
  }): Promise<AccessSession> {
    const id = input.id ?? randomUUID();
    const createdAt = nowIso();
    await this.client.execute({
      sql: `INSERT INTO access_sessions
        (id, status, client_ip_hash, user_agent_hash, created_at, expires_at)
        VALUES (?, 'active', ?, ?, ?, ?)`,
      args: [
        id,
        input.clientIp ? hashPrivateMetadata(input.clientIp) : null,
        input.userAgent ? hashPrivateMetadata(input.userAgent) : null,
        createdAt,
        input.expiresAt,
      ],
    });
    return { id, status: "active", expiresAt: input.expiresAt, createdAt };
  }

  async findActive(id: string, at = new Date()): Promise<AccessSession | null> {
    const result = await this.client.execute({
      sql: `SELECT id, status, expires_at, created_at FROM access_sessions
        WHERE id = ? AND status = 'active' AND expires_at > ?`,
      args: [id, at.toISOString()],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      status: "active",
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
    };
  }

  async revoke(id: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `UPDATE access_sessions SET status = 'revoked', revoked_at = ?
        WHERE id = ? AND status = 'active'`,
      args: [nowIso(), id],
    });
    return result.rowsAffected === 1;
  }
}

export interface StoredCredential {
  id: string;
  accessSessionId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresAt: string;
  accountId: string | null;
  scope: string | null;
  version: number;
  status: "active" | "invalid" | "revoked";
}

export class OAuthCredentialRepository {
  constructor(private readonly client: Client) {}

  async upsert(input: Omit<StoredCredential, "id" | "version" | "status">): Promise<StoredCredential> {
    const existing = await this.findBySession(input.accessSessionId);
    const id = existing?.id ?? randomUUID();
    const version = (existing?.version ?? 0) + 1;
    const timestamp = nowIso();
    await this.client.execute({
      sql: `INSERT INTO oauth_credentials
        (id, access_session_id, encrypted_access_token, encrypted_refresh_token,
         account_id, scope, expires_at, credential_version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(access_session_id) DO UPDATE SET
          encrypted_access_token = excluded.encrypted_access_token,
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          account_id = excluded.account_id,
          scope = excluded.scope,
          expires_at = excluded.expires_at,
          credential_version = excluded.credential_version,
          status = 'active',
          refresh_lease_until = NULL,
          updated_at = excluded.updated_at`,
      args: [
        id,
        input.accessSessionId,
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.accountId,
        input.scope,
        input.expiresAt,
        version,
        timestamp,
        timestamp,
      ],
    });
    return { id, ...input, version, status: "active" };
  }

  async findBySession(accessSessionId: string): Promise<StoredCredential | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM oauth_credentials WHERE access_session_id = ?`,
      args: [accessSessionId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      accessSessionId: String(row.access_session_id),
      encryptedAccessToken: String(row.encrypted_access_token),
      encryptedRefreshToken: rowString(row.encrypted_refresh_token),
      expiresAt: String(row.expires_at),
      accountId: rowString(row.account_id),
      scope: rowString(row.scope),
      version: Number(row.credential_version),
      status: String(row.status) as StoredCredential["status"],
    };
  }

  async rotateIfVersion(
    accessSessionId: string,
    expectedVersion: number,
    input: Pick<
      StoredCredential,
      "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt"
    >,
  ): Promise<boolean> {
    const result = await this.client.execute({
      sql: `UPDATE oauth_credentials SET encrypted_access_token = ?,
        encrypted_refresh_token = ?, expires_at = ?, credential_version = credential_version + 1,
        refresh_lease_until = NULL, updated_at = ?
        WHERE access_session_id = ? AND credential_version = ? AND status = 'active'`,
      args: [
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.expiresAt,
        nowIso(),
        accessSessionId,
        expectedVersion,
      ],
    });
    return result.rowsAffected === 1;
  }

  async acquireRefreshLease(input: {
    accessSessionId: string;
    expectedVersion: number;
    now: string;
    leaseUntil: string;
  }): Promise<boolean> {
    const result = await this.client.execute({
      sql: `UPDATE oauth_credentials SET refresh_lease_until = ?, updated_at = ?
        WHERE access_session_id = ? AND credential_version = ? AND status = 'active'
          AND (refresh_lease_until IS NULL OR refresh_lease_until <= ?)`,
      args: [
        input.leaseUntil,
        input.now,
        input.accessSessionId,
        input.expectedVersion,
        input.now,
      ],
    });
    return result.rowsAffected === 1;
  }

  async releaseRefreshLease(
    accessSessionId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE oauth_credentials SET refresh_lease_until = NULL, updated_at = ?
        WHERE access_session_id = ? AND credential_version = ?`,
      args: [nowIso(), accessSessionId, expectedVersion],
    });
  }
}

export interface StoredOAuthAttempt {
  id: string;
  accessSessionId: string;
  flow: "pkce" | "device";
  stateHash: string | null;
  encryptedPayload: string;
  redirectUri: string | null;
  pollIntervalSeconds: number | null;
  nextPollAt: string | null;
  expiresAt: string;
}

export class OAuthAttemptRepository {
  constructor(private readonly client: Client) {}

  async create(input: Omit<StoredOAuthAttempt, "id"> & { id?: string }): Promise<string> {
    const id = input.id ?? randomUUID();
    await this.client.execute({
      sql: `INSERT INTO oauth_attempts
        (id, access_session_id, flow, state_hash, encrypted_payload, redirect_uri,
         poll_interval_seconds, next_poll_at, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.accessSessionId,
        input.flow,
        input.stateHash,
        input.encryptedPayload,
        input.redirectUri,
        input.pollIntervalSeconds,
        input.nextPollAt,
        nowIso(),
        input.expiresAt,
      ],
    });
    return id;
  }

  async findPending(
    id: string,
    accessSessionId: string,
    at = new Date(),
  ): Promise<StoredOAuthAttempt | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM oauth_attempts
        WHERE id = ? AND access_session_id = ? AND consumed_at IS NULL AND expires_at > ?`,
      args: [id, accessSessionId, at.toISOString()],
    });
    return result.rows[0] ? mapOAuthAttempt(result.rows[0]) : null;
  }

  async findPendingByStateHash(
    stateHash: string,
    at = new Date(),
  ): Promise<StoredOAuthAttempt | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM oauth_attempts
        WHERE state_hash = ? AND flow = 'pkce' AND consumed_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
      args: [stateHash, at.toISOString()],
    });
    return result.rows[0] ? mapOAuthAttempt(result.rows[0]) : null;
  }

  async claimDevicePoll(input: {
    id: string;
    accessSessionId: string;
    now: string;
    nextPollAt: string;
  }): Promise<boolean> {
    const result = await this.client.execute({
      sql: `UPDATE oauth_attempts SET next_poll_at = ?
        WHERE id = ? AND access_session_id = ? AND flow = 'device'
          AND consumed_at IS NULL AND expires_at > ?
          AND (next_poll_at IS NULL OR next_poll_at <= ?)`,
      args: [
        input.nextPollAt,
        input.id,
        input.accessSessionId,
        input.now,
        input.now,
      ],
    });
    return result.rowsAffected === 1;
  }

  async consume(id: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: "UPDATE oauth_attempts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
      args: [nowIso(), id],
    });
    return result.rowsAffected === 1;
  }
}

function mapOAuthAttempt(row: Record<string, InValue>): StoredOAuthAttempt {
  return {
    id: String(row.id),
    accessSessionId: String(row.access_session_id),
    flow: String(row.flow) as StoredOAuthAttempt["flow"],
    stateHash: rowString(row.state_hash),
    encryptedPayload: String(row.encrypted_payload),
    redirectUri: rowString(row.redirect_uri),
    pollIntervalSeconds:
      row.poll_interval_seconds == null ? null : Number(row.poll_interval_seconds),
    nextPollAt: rowString(row.next_poll_at),
    expiresAt: String(row.expires_at),
  };
}

export class ResearchRepository {
  constructor(private readonly client: Client) {}

  async createRequest(input: {
    accessSessionId: string;
    question: string;
    context?: string;
    constraints?: unknown;
  }): Promise<string> {
    const id = randomUUID();
    await this.client.execute({
      sql: `INSERT INTO research_requests
        (id, access_session_id, question, context, constraints_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.accessSessionId,
        input.question,
        input.context ?? null,
        json(input.constraints),
        nowIso(),
      ],
    });
    return id;
  }

  async createRun(input: {
    requestId: string;
    workspaceId: string;
    skillBundleVersion: string;
  }): Promise<string> {
    const id = randomUUID();
    const timestamp = nowIso();
    await this.client.execute({
      sql: `INSERT INTO runs
        (id, request_id, workspace_id, status, skill_bundle_version, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      args: [id, input.requestId, input.workspaceId, input.skillBundleVersion, timestamp, timestamp],
    });
    return id;
  }

  async attachSession(input: {
    runId: string;
    accessSessionId: string;
    eveSessionId: string;
  }): Promise<boolean> {
    const result = await this.client.execute({
      sql: `UPDATE runs SET eve_session_id = ?, status = 'running', updated_at = ?
        WHERE id = ? AND request_id IN (
          SELECT id FROM research_requests WHERE access_session_id = ?
        ) AND (eve_session_id IS NULL OR eve_session_id = ?)`,
      args: [
        input.eveSessionId,
        nowIso(),
        input.runId,
        input.accessSessionId,
        input.eveSessionId,
      ],
    });
    return result.rowsAffected === 1;
  }

  async findRunByEveSession(eveSessionId: string) {
    const result = await this.client.execute({
      sql: `SELECT id, request_id, eve_session_id, workspace_id, status,
        skill_bundle_version, created_at, updated_at
        FROM runs WHERE eve_session_id = ?`,
      args: [eveSessionId],
    });
    return result.rows[0] ?? null;
  }

  async findOwnedRun(runId: string, accessSessionId: string) {
    const result = await this.client.execute({
      sql: `SELECT runs.id, runs.request_id, runs.eve_session_id, runs.workspace_id,
        runs.status, runs.skill_bundle_version, runs.created_at, runs.updated_at,
        research_requests.question, research_requests.context,
        research_requests.constraints_json
        FROM runs JOIN research_requests ON research_requests.id = runs.request_id
        WHERE runs.id = ? AND research_requests.access_session_id = ?`,
      args: [runId, accessSessionId],
    });
    return result.rows[0] ?? null;
  }

  async listOwnedRuns(accessSessionId: string, limit = 20) {
    const result = await this.client.execute({
      sql: `SELECT runs.id, runs.eve_session_id, runs.workspace_id, runs.status,
        runs.created_at, runs.updated_at, research_requests.question
        FROM runs JOIN research_requests ON research_requests.id = runs.request_id
        WHERE research_requests.access_session_id = ?
        ORDER BY runs.created_at DESC LIMIT ?`,
      args: [accessSessionId, limit],
    });
    return result.rows;
  }

  async setRunStatus(
    runId: string,
    status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled",
  ): Promise<void> {
    await this.client.execute({
      sql: "UPDATE runs SET status = ?, updated_at = ? WHERE id = ?",
      args: [status, nowIso(), runId],
    });
  }

  async appendEvent(input: {
    id?: string;
    runId: string;
    sequence: number;
    type: string;
    summary: string;
    payload?: unknown;
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO run_events
        (id, run_id, sequence, type, summary, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, input.runId, input.sequence, input.type, input.summary, json(input.payload), nowIso()],
    });
    return id;
  }

  async listEvents(runId: string, afterSequence = -1, limit = 500) {
    const result = await this.client.execute({
      sql: `SELECT id, sequence, type, summary, payload_json, created_at
        FROM run_events WHERE run_id = ? AND sequence > ?
        ORDER BY sequence ASC LIMIT ?`,
      args: [runId, afterSequence, limit],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      sequence: Number(row.sequence),
      type: String(row.type),
      summary: String(row.summary),
      payload: JSON.parse(String(row.payload_json)),
      createdAt: String(row.created_at),
    }));
  }

  async storeArtifact(input: {
    runId: string;
    path: string;
    mediaType: string;
    content: string;
    parentArtifactId?: string;
  }): Promise<{ id: string; contentHash: string; sizeBytes: number }> {
    const id = randomUUID();
    const contentHash = `sha256:${createHash("sha256").update(input.content).digest("hex")}`;
    const sizeBytes = Buffer.byteLength(input.content);
    await this.client.execute({
      sql: `INSERT INTO artifacts
        (id, run_id, path, media_type, content_hash, content, size_bytes, parent_artifact_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.runId,
        input.path,
        input.mediaType,
        contentHash,
        input.content,
        sizeBytes,
        input.parentArtifactId ?? null,
        nowIso(),
      ],
    });
    return { id, contentHash, sizeBytes };
  }

  async findLatestArtifact(runId: string, path: string) {
    const result = await this.client.execute({
      sql: `SELECT id, path, media_type, content_hash, content, size_bytes, parent_artifact_id, created_at
        FROM artifacts WHERE run_id = ? AND path = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      args: [runId, path],
    });
    return result.rows[0] ?? null;
  }

  async listArtifacts(runId: string) {
    const result = await this.client.execute({
      sql: `SELECT artifacts.id, artifacts.path, artifacts.media_type,
        artifacts.content_hash, artifacts.size_bytes, artifacts.parent_artifact_id,
        artifacts.created_at FROM artifacts
        JOIN (
          SELECT path, MAX(rowid) AS latest_rowid FROM artifacts
          WHERE run_id = ? GROUP BY path
        ) latest ON latest.latest_rowid = artifacts.rowid
        ORDER BY artifacts.path`,
      args: [runId],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      mediaType: String(row.media_type),
      contentHash: String(row.content_hash),
      sizeBytes: Number(row.size_bytes),
      parentArtifactId: rowString(row.parent_artifact_id),
      createdAt: String(row.created_at),
    }));
  }

  async findArtifact(runId: string, artifactId: string) {
    const result = await this.client.execute({
      sql: `SELECT id, path, media_type, content_hash, content, size_bytes,
        parent_artifact_id, created_at FROM artifacts WHERE run_id = ? AND id = ?`,
      args: [runId, artifactId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      path: String(row.path),
      mediaType: String(row.media_type),
      contentHash: String(row.content_hash),
      content: String(row.content),
      sizeBytes: Number(row.size_bytes),
      parentArtifactId: rowString(row.parent_artifact_id),
      createdAt: String(row.created_at),
    };
  }

  async addFeedback(input: {
    runId: string;
    artifactId?: string;
    reportContentHash: string;
    selectedText?: string;
    feedbackText: string;
  }): Promise<string> {
    const id = randomUUID();
    await this.client.execute({
      sql: `INSERT INTO feedback
        (id, run_id, artifact_id, report_content_hash, selected_text, feedback_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.runId,
        input.artifactId ?? null,
        input.reportContentHash,
        input.selectedText ?? null,
        input.feedbackText,
        nowIso(),
      ],
    });
    return id;
  }
}
