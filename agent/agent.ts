import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";

import { resolveRuntimeConfig } from "../src/config";
import { resolveCodexModel } from "../src/codex/model";

const config = resolveRuntimeConfig();

const deterministicResearchModel = mockModel({
  modelId: "deep-research-fixture",
  provider: "vercel-eve-demo",
  respond: ({ toolResults }) => {
    if (toolResults.length === 0) {
      return {
        toolCalls: [
          {
            name: "web_search",
            input: {
              query: "Vercel eve 如何组合 durable session、skills 与 tools",
              depth: "advanced",
              maxResults: 2,
            },
          },
        ],
      };
    }

    return [
      "# Mock 深度调研报告",
      "",
      "## 结论",
      "这次运行完整经过了 eve session、按需 skill、typed tool 和流式返回，但没有访问模型或搜索供应商。",
      "",
      "## 证据",
      "搜索工具返回了两个合成来源，用于验证引用、usage 和前端渲染。",
      "",
      "## 限制",
      "Mock 结果不能用于真实产品判断。切换到 live 前必须配置认证、预算和 credential。",
      "",
      "## Usage",
      `工具结果：${JSON.stringify(toolResults[0]?.output ?? {})}`,
    ].join("\n");
  },
});

const unavailableCodexModel = mockModel({
  modelId: "codex-authorization-required",
  provider: "fail-closed",
  respond: () => {
    throw new Error("ChatGPT authorization is unavailable. Reconnect and retry.");
  },
});

export default defineAgent(
  config.mode === "live"
    ? {
        model: defineDynamic({
          fallback: unavailableCodexModel,
          events: {
            "step.started": async (_event, context) => {
              const initiator = context.session.auth.initiator;
              const current = context.session.auth.current;
              if (
                !initiator ||
                !current ||
                initiator.principalId !== current.principalId
              ) {
                return unavailableCodexModel;
              }
              try {
                return await resolveCodexModel();
              } catch {
                return unavailableCodexModel;
              }
            },
          },
        }),
        modelContextWindowTokens: 500_000,
        reasoning: "medium" as const,
      }
    : {
        model: deterministicResearchModel,
        modelContextWindowTokens: 100_000,
      },
);
