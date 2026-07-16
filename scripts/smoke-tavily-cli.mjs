import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

if (
  process.env.RUN_LIVE_TESTS !== "1" ||
  process.env.ALLOW_LIVE_API !== "1" ||
  process.env.SEARCH_BACKEND !== "tavily" ||
  !process.env.TAVILY_API_KEY
) {
  throw new Error("Tavily CLI smoke 要求显式 live 开关和 credential");
}

const port = 4320;
const origin = `http://127.0.0.1:${port}`;
const child = spawn("./node_modules/.bin/eve", ["dev", "--no-ui", "--port", String(port)], {
  env: { ...process.env, EVE_DEMO_MODE: "mock" },
  stdio: ["ignore", "ignore", "pipe"],
});
let lastError = "";
child.stderr.on("data", (chunk) => {
  lastError = `${lastError}${String(chunk)}`.slice(-4_000);
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`${origin}/eve/v1/health`);
      if (response.ok) return;
    } catch {
      // The first live sandbox template may need setup time.
    }
    await delay(500);
  }
  throw new Error("Tavily CLI smoke server 未在 120 秒内启动");
}

async function run() {
  await waitForHealth();
  const createResponse = await fetch(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "执行一次 Tavily CLI 搜索" }),
  });
  if (!createResponse.ok) throw new Error(`创建 CLI smoke session 失败：${createResponse.status}`);
  const session = await createResponse.json();
  const streamResponse = await fetch(
    `${origin}/eve/v1/session/${session.sessionId}/stream?startIndex=0`,
  );
  if (!streamResponse.ok || !streamResponse.body) throw new Error("无法读取 CLI smoke stream");

  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawWaiting = false;
  let sawCliResult = false;
  while (!sawWaiting) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.includes('"toolName":"web_search"') && line.includes('"backend":"tavily"')) {
        sawCliResult = true;
      }
      if (line.includes("session.waiting")) sawWaiting = true;
    }
  }
  await reader.cancel();
  if (!sawCliResult) throw new Error("未观察到 Tavily CLI web_search result");
  if (!sawWaiting) throw new Error("CLI smoke 未到达 session.waiting");
  console.log(`Tavily CLI smoke passed: ${session.sessionId}`);
}

try {
  await Promise.race([
    run(),
    delay(180_000).then(() => {
      throw new Error("Tavily CLI smoke 超过 180 秒硬超时");
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
