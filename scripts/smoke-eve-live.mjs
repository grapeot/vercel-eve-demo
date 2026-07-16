import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

if (
  process.env.RUN_LIVE_EVE_SMOKE !== "1" ||
  process.env.ALLOW_LIVE_API !== "1" ||
  process.env.EVE_DEMO_MODE !== "live" ||
  process.env.SEARCH_BACKEND !== "tavily"
) {
  throw new Error("live Eve smoke 要求显式开启全部安全门");
}
if (!process.env.AI_GATEWAY_API_KEY || !process.env.TAVILY_API_KEY) {
  throw new Error("live Eve smoke 缺少 AI Gateway 或 Tavily credential");
}

const port = 4319;
const origin = `http://127.0.0.1:${port}`;
const child = spawn("./node_modules/.bin/eve", ["dev", "--no-ui", "--port", String(port)], {
  env: process.env,
  stdio: ["ignore", "ignore", "pipe"],
});
let lastError = "";
child.stderr.on("data", (chunk) => {
  lastError = `${lastError}${String(chunk)}`.slice(-4_000);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${origin}/eve/v1/health`);
      if (response.ok) return;
    } catch {
      // The compiler and local runtime are still starting.
    }
    await delay(250);
  }
  throw new Error("Eve live server 未在 30 秒内启动");
}

async function run() {
  await waitForHealth();
  const createResponse = await fetch(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "调研 Vercel eve 的 durable session 与 skill/tool 组合，给出简短结论和来源。",
    }),
  });
  if (!createResponse.ok) throw new Error(`创建 live session 失败：${createResponse.status}`);
  const session = await createResponse.json();
  if (!session.sessionId) throw new Error("live session response 缺少 sessionId");

  const controller = new AbortController();
  const streamResponse = await fetch(
    `${origin}/eve/v1/session/${session.sessionId}/stream?startIndex=0`,
    { signal: controller.signal },
  );
  if (!streamResponse.ok || !streamResponse.body) throw new Error("无法读取 live stream");

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

  if (!sawSearchTool) throw new Error("live Agent 未调用 web_search override");
  if (!sawWaiting) throw new Error("live Agent 未到达 session.waiting");
  console.log(`Eve live smoke passed: ${session.sessionId}`);
}

try {
  await Promise.race([
    run(),
    delay(120_000).then(() => {
      throw new Error("Eve live smoke 超过 120 秒硬超时");
    }),
  ]);
} catch (error) {
  console.error(error);
  if (lastError) console.error(lastError);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
