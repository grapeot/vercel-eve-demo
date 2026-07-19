import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = 4318;
const origin = `http://127.0.0.1:${port}`;
const evePort = 4319;
const eveOrigin = `http://127.0.0.1:${evePort}`;
const logs = [];
const tempDirectory = await mkdtemp(join(tmpdir(), "research-workbench-smoke-"));
const eveAppDirectory = join(tempDirectory, "eve-app");
const smokeDistDirectory = `.next-smoke-${process.pid}`;
const trackedNextFiles = new Map(
  await Promise.all(
    ["next-env.d.ts", "tsconfig.json"].map(async (path) => [
      path,
      await readFile(path, "utf8"),
    ]),
  ),
);
const challenge = randomBytes(32).toString("base64url");
const serverEnv = {
  ...process.env,
  EVE_DEMO_MODE: "mock",
  SEARCH_BACKEND: "mock",
  ALLOW_LIVE_API: "0",
  ACCESS_ALLOWED_CIDRS: "127.0.0.1/32",
  ACCESS_CHALLENGE_SECRET: challenge,
  ACCESS_COOKIE_SIGNING_KEY: randomBytes(32).toString("base64url"),
  CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  TURSO_DATABASE_URL: `file:${join(tempDirectory, "smoke.sqlite")}`,
  NEXT_DIST_DIR: smokeDistDirectory,
  EVE_BASE_URL: eveOrigin,
};

const migration = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/migrate-database.ts"],
  { env: serverEnv, stdio: ["ignore", "pipe", "pipe"] },
);
const migrationOutput = [];
for (const stream of [migration.stdout, migration.stderr]) {
  stream.on("data", (chunk) => migrationOutput.push(String(chunk)));
}
const migrationExitCode = await new Promise((resolve) => migration.once("exit", resolve));
if (migrationExitCode !== 0) {
  throw new Error(`Test database migration failed:\n${migrationOutput.join("")}`);
}

await mkdir(eveAppDirectory);
for (const path of ["agent", "src", "package.json", "tsconfig.json"]) {
  await cp(path, join(eveAppDirectory, path), { recursive: true });
}
await symlink(join(process.cwd(), "node_modules"), join(eveAppDirectory, "node_modules"));

const eveChild = spawn(
  "./node_modules/.bin/eve",
  ["dev", "--no-ui", "--port", String(evePort)],
  {
    cwd: eveAppDirectory,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const child = spawn(
  "./node_modules/.bin/next",
  ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

for (const stream of [child.stdout, child.stderr, eveChild.stdout, eveChild.stderr]) {
  stream.on("data", (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 100) logs.shift();
  });
}

async function waitFor(path) {
  return waitForUrl(`${origin}${path}`);
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Next and the Eve sidecar are still starting.
    }
    await delay(250);
  }
  throw new Error(`${url} 未在 25 秒内启动`);
}

async function run() {
  await waitForUrl(`${eveOrigin}/eve/v1/health`);
  const lockedPage = await waitFor("/");
  const lockedHtml = await lockedPage.text();
  if (!lockedHtml.includes("Private challenge")) {
    throw new Error("未授权首页没有进入 owner challenge gate");
  }

  const denied = await fetch(`${origin}/api/access/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge: "wrong" }),
  });
  if (denied.status !== 401) throw new Error("错误 challenge 未被拒绝");

  const authorized = await fetch(`${origin}/api/access/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge }),
  });
  const setCookie = authorized.headers.get("set-cookie");
  if (!authorized.ok || !setCookie) throw new Error("正确 challenge 未签发 cookie");
  const cookie = setCookie.split(";", 1)[0];

  const page = await fetch(`${origin}/`, { headers: { Cookie: cookie } });
  const html = await page.text();
  if (!html.includes("Restoring the research workspace")) {
    throw new Error("首页缺少 Workbench bootstrap");
  }

  const healthResponse = await fetch(`${origin}/api/health`, {
    headers: { Cookie: cookie },
  });
  const health = await healthResponse.json();
  if (!health.ok || health.config?.mode !== "mock") {
    throw new Error("Next health 未报告 mock 模式");
  }

  const eveResponse = await fetch(`${origin}/eve/v1/info`, {
    headers: { Cookie: cookie },
  });
  const eveInfo = await eveResponse.json();
  if (!eveResponse.ok) {
    throw new Error(`Eve info returned HTTP ${eveResponse.status}: ${JSON.stringify(eveInfo)}`);
  }
  const webSearch = eveInfo.tools?.authored?.find((tool) => tool.name === "web_search");
  const webExtract = eveInfo.tools?.authored?.find((tool) => tool.name === "web_extract");
  const publishArtifacts = eveInfo.tools?.authored?.find(
    (tool) => tool.name === "publish_artifacts",
  );
  const skillNames = new Set(
    eveInfo.skills?.static?.map((skill) => skill.name) ?? [],
  );
  if (
    !webSearch?.replacesFrameworkTool ||
    !webExtract ||
    !publishArtifacts ||
    !["deep-research", "tavily", "external-writing"].every((name) =>
      skillNames.has(name),
    )
  ) {
    throw new Error("Eve manifest 缺少 typed Tavily tools 或完整 Skill Bundle");
  }
  if (!eveInfo.tools?.disabledFramework?.includes("bash")) {
    throw new Error("Eve manifest 未禁用 built-in bash");
  }

  const runResponse = await fetch(`${origin}/api/runs`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "Verify the Workbench product projection",
      context: "Offline Web smoke",
      constraints: { audience: "test" },
    }),
  });
  if (!runResponse.ok) throw new Error(`创建 product run 失败：${runResponse.status}`);
  const run = await runResponse.json();
  const sessionId = "web-smoke-eve-session";
  const attachResponse = await fetch(`${origin}/api/runs/${run.runId}`, {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ eveSessionId: sessionId }),
  });
  if (!attachResponse.ok) throw new Error("product run 无法绑定 Eve session");
  const eventResponse = await fetch(`${origin}/api/runs/${run.runId}/events`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceSessionId: sessionId,
      startIndex: 0,
      events: [
        { type: "session.started", data: { sequence: 0 } },
        {
          type: "actions.requested",
          data: {
            sequence: 1,
            actions: [
              {
                kind: "tool-call",
                callId: "call-1",
                toolName: "web_search",
                input: { query: "test", authorization: "must-not-persist" },
              },
            ],
          },
        },
        { type: "session.waiting", data: { sequence: 2, continuationToken: "secret" } },
      ],
    }),
  });
  if (!eventResponse.ok) throw new Error("Eve event projection 写入失败");
  const productRun = await (
    await fetch(`${origin}/api/runs/${run.runId}`, { headers: { Cookie: cookie } })
  ).json();
  const productJson = JSON.stringify(productRun);
  if (productRun.events?.length !== 3 || !productJson.includes("[REDACTED]")) {
    throw new Error("product event projection 缺少 timeline 或 redaction");
  }
  if (productJson.includes("must-not-persist") || productJson.includes('"secret"')) {
    throw new Error("product event projection 泄漏 secret");
  }
  const deleteRunResponse = await fetch(`${origin}/api/runs/${run.runId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  if (!deleteRunResponse.ok) throw new Error("product run hard delete 失败");
  const deletedRunResponse = await fetch(`${origin}/api/runs/${run.runId}`, {
    headers: { Cookie: cookie },
  });
  if (deletedRunResponse.status !== 404) throw new Error("hard-deleted run 仍可读取");

  const disconnectResponse = await fetch(`${origin}/api/codex/status`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  if (!disconnectResponse.ok) throw new Error("Codex local disconnect 失败");

  const unconfirmedPurge = await fetch(`${origin}/api/owner/data`, {
    method: "DELETE",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "wrong" }),
  });
  if (unconfirmedPurge.status !== 400) throw new Error("owner purge 未要求精确确认");
  const purgeResponse = await fetch(`${origin}/api/owner/data`, {
    method: "DELETE",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "PURGE OWNER DATA" }),
  });
  if (!purgeResponse.ok) throw new Error("owner data purge 失败");
  const staleCookieResponse = await fetch(`${origin}/api/health`, {
    headers: { Cookie: cookie },
  });
  if (staleCookieResponse.status !== 401) {
    throw new Error("owner purge 后旧 access cookie 仍可用");
  }
  console.log("Web smoke passed: gate + Workbench APIs + teardown + Eve manifest");
}

try {
  await run();
} catch (error) {
  console.error(error);
  console.error(logs.join(""));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  eveChild.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  await Promise.race([
    new Promise((resolve) => eveChild.once("exit", resolve)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (eveChild.exitCode === null) eveChild.kill("SIGKILL");
  await rm(tempDirectory, { recursive: true, force: true });
  await rm(smokeDistDirectory, { recursive: true, force: true });
  await Promise.all(
    [...trackedNextFiles].map(([path, content]) => writeFile(path, content)),
  );
}
