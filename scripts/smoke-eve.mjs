import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Sandbox } from "microsandbox";

import { createDatabaseClient } from "../src/storage/client.ts";
import { AccessSessionRepository, ResearchRepository } from "../src/storage/repositories.ts";
import { migrateDatabase } from "../src/storage/schema.ts";

const port = 4317;
const origin = `http://127.0.0.1:${port}`;
const logs = [];
let sessionId;
const tempDirectory = await mkdtemp(join(tmpdir(), "eve-smoke-"));
const eveAppDirectory = join(tempDirectory, "eve-app");
const databaseUrl = `file:${join(tempDirectory, "smoke.db")}`;
const database = createDatabaseClient({ url: databaseUrl });
await migrateDatabase(database);
await new AccessSessionRepository(database).create({
  id: "offline-mock-owner",
  expiresAt: "2030-01-01T00:00:00.000Z",
});
const research = new ResearchRepository(database);
const requestId = await research.createRequest({
  accessSessionId: "offline-mock-owner",
  question: "Verify server-side event durability",
});
const runId = await research.createRun({
  requestId,
  workspaceId: "eve-smoke-workspace",
  skillBundleVersion: "smoke-bundle",
});
await mkdir(eveAppDirectory);
for (const path of ["agent", "src", "package.json", "tsconfig.json"]) {
  await cp(path, join(eveAppDirectory, path), { recursive: true });
}
await symlink(join(process.cwd(), "node_modules"), join(eveAppDirectory, "node_modules"));

const child = spawn("./node_modules/.bin/eve", ["dev", "--no-ui", "--port", String(port)], {
  cwd: eveAppDirectory,
  env: {
    ...process.env,
    EVE_DEMO_MODE: "mock",
    SEARCH_BACKEND: "mock",
    ALLOW_LIVE_API: "0",
    TURSO_DATABASE_URL: databaseUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 80) logs.shift();
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/eve/v1/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error("eve health endpoint 未在 20 秒内启动");
}

async function run() {
  await waitForHealth();
  const createResponse = await fetch(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "请执行 mock 深度调研" }),
  });
  if (!createResponse.ok) throw new Error(`创建 session 失败：${createResponse.status}`);
  const session = await createResponse.json();
  if (!session.sessionId || !session.continuationToken) {
    throw new Error("session response 缺少 ID 或 continuation token");
  }
  sessionId = session.sessionId;

  const controller = new AbortController();
  const streamResponse = await fetch(
    `${origin}/eve/v1/session/${session.sessionId}/stream?startIndex=0`,
    { signal: controller.signal },
  );
  if (!streamResponse.ok || !streamResponse.body) throw new Error("无法读取 session stream");

  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawWaiting = false;
  let sawSearchTool = false;
  while (!sawWaiting) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.includes('"toolName":"web_search"')) sawSearchTool = true;
      if (line.includes("session.waiting")) sawWaiting = true;
    }
  }
  controller.abort();

  if (!sawWaiting) throw new Error("stream 未到达 session.waiting");
  if (!sawSearchTool) throw new Error("mock session 未调用 web_search override");

  const persistedRun = await research.findRunByEveSession(session.sessionId);
  const persistedEvents = await research.listEvents(runId);
  if (persistedRun?.status !== "waiting" || persistedEvents.length === 0) {
    throw new Error("root hook 未持久化 session mapping、run status 或 timeline events");
  }
  console.log(`Eve smoke passed: ${session.sessionId}`);
}

try {
  await run();
} catch (error) {
  console.error(error);
  console.error(logs.join(""));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }

  if (sessionId) {
    try {
      const sandboxes = await Sandbox.listWith({ labels: { sessionId } });
      for (const sandbox of sandboxes) {
        if (sandbox.status === "running" || sandbox.status === "draining") {
          await sandbox.stopWithTimeout(2_000);
        }
        await Sandbox.remove(sandbox.name);
      }
    } catch (error) {
      console.error(`清理 Eve smoke sandbox 失败：${error}`);
      process.exitCode = 1;
    }
  }
  database.close();
  await rm(tempDirectory, { recursive: true, force: true });
}
