import { defineTool } from "eve/tools";

import { resolveRuntimeConfig } from "../../src/config";
import {
  executeSearch,
  searchInputSchema,
  searchOutputSchema,
} from "../../src/research/search";

const SAFE_CALL_ID = /^[A-Za-z0-9_-]+$/;

function safeCliError(stderr: string) {
  return stderr.replace(/tvly-[A-Za-z0-9_-]+/g, "[REDACTED]").trim().slice(0, 500);
}

export default defineTool({
  description:
    "使用 Sandbox 中固定版本的 Tavily CLI 搜索网页，返回来源、相关性与 credits。需要当前外部事实时使用。",
  inputSchema: searchInputSchema,
  outputSchema: searchOutputSchema,
  async execute(input, ctx) {
    const config = resolveRuntimeConfig();
    if (config.searchBackend === "mock") {
      return executeSearch(input, config);
    }
    if (!SAFE_CALL_ID.test(ctx.callId)) throw new Error("无效的 tool call id");

    const sandbox = await ctx.getSandbox();
    const requestPath = `requests/${ctx.callId}.json`;
    await sandbox.writeTextFile({
      path: requestPath,
      content: JSON.stringify(searchInputSchema.parse(input)),
    });

    try {
      return await executeSearch(input, config, async () => {
        const absoluteRequestPath = sandbox.resolvePath(requestPath);
        const result = await sandbox.run({
          command: `python3 /workspace/run_tavily_search.py ${absoluteRequestPath}`,
        });
        if (result.exitCode !== 0) {
          const detail = safeCliError(result.stderr);
          throw new Error(
            `Tavily CLI 失败：exit ${result.exitCode}${detail ? `；${detail}` : ""}`,
          );
        }
        return result.stdout;
      });
    } finally {
      await sandbox.removePath({ path: requestPath, force: true });
    }
  },
});
