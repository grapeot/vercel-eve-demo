import type { Client } from "@libsql/client";

export const SCHEMA_VERSION = 4;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
    client_ip_hash TEXT,
    user_agent_hash TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_attempts (
    id TEXT PRIMARY KEY,
    access_session_id TEXT NOT NULL REFERENCES access_sessions(id) ON DELETE CASCADE,
    flow TEXT NOT NULL CHECK (flow IN ('pkce', 'device')),
    state_hash TEXT,
    encrypted_payload TEXT NOT NULL,
    redirect_uri TEXT,
    poll_interval_seconds INTEGER,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_credentials (
    id TEXT PRIMARY KEY,
    access_session_id TEXT NOT NULL UNIQUE REFERENCES access_sessions(id) ON DELETE CASCADE,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    account_id TEXT,
    scope TEXT,
    expires_at TEXT NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('active', 'invalid', 'revoked')),
    refresh_lease_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS research_requests (
    id TEXT PRIMARY KEY,
    access_session_id TEXT NOT NULL REFERENCES access_sessions(id),
    question TEXT NOT NULL,
    context TEXT,
    constraints_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES research_requests(id),
    eve_session_id TEXT,
    workspace_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
    skill_bundle_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    source_session_id TEXT NOT NULL,
    parent_session_id TEXT,
    source_event_key TEXT NOT NULL UNIQUE,
    source_created_at TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(run_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    parent_artifact_id TEXT REFERENCES artifacts(id),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    artifact_id TEXT REFERENCES artifacts(id),
    report_content_hash TEXT NOT NULL,
    selected_text TEXT,
    feedback_text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS skill_bundle_versions (
    version TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_summaries (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    search_count INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS oauth_attempts_session_idx ON oauth_attempts(access_session_id, expires_at)",
  "CREATE INDEX IF NOT EXISTS runs_created_idx ON runs(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS run_events_cursor_idx ON run_events(run_id, sequence)",
  "CREATE INDEX IF NOT EXISTS artifacts_path_idx ON artifacts(run_id, path, created_at DESC)",
];

export async function migrateDatabase(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.batch(
    schemaStatements.map((sql) => ({ sql, args: [] })),
    "write",
  );
  await client.execute({
    sql: "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
    args: [1, new Date().toISOString()],
  });
  const versionTwo = await client.execute(
    "SELECT 1 FROM schema_migrations WHERE version = 2",
  );
  if (versionTwo.rows.length === 0) {
    await client.batch(
      [
        "ALTER TABLE oauth_attempts ADD COLUMN next_poll_at TEXT",
        {
          sql: "INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)",
          args: [new Date().toISOString()],
        },
      ],
      "write",
    );
  }
  const versionThree = await client.execute(
    "SELECT 1 FROM schema_migrations WHERE version = 3",
  );
  if (versionThree.rows.length === 0) {
    await client.execute("PRAGMA foreign_keys = OFF");
    try {
      await client.batch(
        [
          "ALTER TABLE oauth_credentials RENAME TO oauth_credentials_v2",
          `CREATE TABLE oauth_credentials (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL UNIQUE,
            legacy_access_session_id TEXT,
            encrypted_access_token TEXT NOT NULL,
            encrypted_refresh_token TEXT,
            account_id TEXT,
            scope TEXT,
            expires_at TEXT NOT NULL,
            credential_version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL CHECK (status IN ('active', 'invalid', 'revoked')),
            refresh_lease_until TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )`,
          `INSERT INTO oauth_credentials
            (id, owner_id, legacy_access_session_id, encrypted_access_token,
             encrypted_refresh_token, account_id, scope, expires_at,
             credential_version, status, refresh_lease_until, created_at, updated_at)
            SELECT id, 'owner', access_session_id, encrypted_access_token,
             encrypted_refresh_token, account_id, scope, expires_at,
             credential_version, status, refresh_lease_until, created_at, updated_at
            FROM oauth_credentials_v2
            WHERE status = 'active'
            ORDER BY updated_at DESC LIMIT 1`,
          "DROP TABLE oauth_credentials_v2",
          {
            sql: "INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)",
            args: [new Date().toISOString()],
          },
        ],
        "write",
      );
    } finally {
      await client.execute("PRAGMA foreign_keys = ON");
    }
  }
  const versionFour = await client.execute(
    "SELECT 1 FROM schema_migrations WHERE version = 4",
  );
  if (versionFour.rows.length === 0) {
    await client.execute("PRAGMA foreign_keys = OFF");
    try {
      await client.batch(
        [
          "ALTER TABLE run_events RENAME TO run_events_v3",
          `CREATE TABLE run_events (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            source_session_id TEXT NOT NULL,
            parent_session_id TEXT,
            source_event_key TEXT NOT NULL UNIQUE,
            source_created_at TEXT NOT NULL,
            type TEXT NOT NULL,
            summary TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            UNIQUE(run_id, sequence)
          )`,
          `INSERT INTO run_events
            (id, run_id, sequence, source_session_id, parent_session_id,
             source_event_key, source_created_at, type, summary, payload_json, created_at)
            SELECT id, run_id, sequence,
              COALESCE((SELECT eve_session_id FROM runs WHERE runs.id = run_events_v3.run_id), 'legacy'),
              NULL, 'legacy:' || run_id || ':' || sequence, created_at,
              type, summary, payload_json, created_at
            FROM run_events_v3`,
          "DROP TABLE run_events_v3",
          "CREATE INDEX IF NOT EXISTS run_events_cursor_idx ON run_events(run_id, sequence)",
          {
            sql: "INSERT INTO schema_migrations(version, applied_at) VALUES (4, ?)",
            args: [new Date().toISOString()],
          },
        ],
        "write",
      );
    } finally {
      await client.execute("PRAGMA foreign_keys = ON");
    }
  }
}
