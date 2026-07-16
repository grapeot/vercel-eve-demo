import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 4318;
const origin = `http://127.0.0.1:${port}`;
const logs = [];
const child = spawn(
  "./node_modules/.bin/next",
  ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: {
      ...process.env,
      EVE_DEMO_MODE: "mock",
      SEARCH_BACKEND: "mock",
      ALLOW_LIVE_API: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 100) logs.shift();
  });
}

async function waitFor(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}${path}`);
      if (response.ok) return response;
    } catch {
      // Next and the Eve sidecar are still starting.
    }
    await delay(250);
  }
  throw new Error(`${path} 未在 25 秒内启动`);
}

async function run() {
  const page = await waitFor("/");
  const html = await page.text();
  if (!html.includes("深度调研")) throw new Error("首页缺少产品标题");

  const health = await (await waitFor("/api/health")).json();
  if (!health.ok || health.config?.mode !== "mock") {
    throw new Error("Next health 未报告 mock 模式");
  }

  const eveInfo = await (await waitFor("/eve/v1/info")).json();
  const webSearch = eveInfo.tools?.authored?.find((tool) => tool.name === "web_search");
  const hasDeepResearch = eveInfo.skills?.static?.some(
    (skill) => skill.name === "deep-research",
  );
  if (!webSearch?.replacesFrameworkTool || !hasDeepResearch) {
    throw new Error("Eve manifest 缺少 web_search override 或 deep-research skill");
  }
  if (!eveInfo.tools?.disabledFramework?.includes("bash")) {
    throw new Error("Eve manifest 未禁用 built-in bash");
  }
  console.log("Web smoke passed: page + health + Eve rewrite");
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
  if (child.exitCode === null) child.kill("SIGKILL");
}
