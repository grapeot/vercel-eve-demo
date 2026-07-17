const SECRET_KEY = /(authorization|token|cookie|secret|password|credential|environment|reasoning)/i;
const MAX_STRING_LENGTH = 10_000;

type JsonRecord = Record<string, unknown>;

export interface ProjectedEvent {
  type: string;
  summary: string;
  payload: JsonRecord;
  runStatus?: "running" | "waiting" | "completed" | "failed" | "cancelled";
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1),
    ]),
  );
}

function actionSummary(action: JsonRecord): string {
  if (action.kind === "tool-call") return `Tool started: ${String(action.toolName)}`;
  if (action.kind === "load-skill") return "Skill load requested";
  if (action.kind === "subagent-call") {
    return `Subagent requested: ${String(action.subagentName)}`;
  }
  return `Action requested: ${String(action.kind ?? "unknown")}`;
}

function summarizeToolOutput(toolName: string, output: unknown): unknown {
  const value = record(output);
  if (toolName === "web_search") {
    return {
      query: value.query,
      sources: Array.isArray(value.sources)
        ? value.sources.slice(0, 10).map((source) => {
            const item = record(source);
            return {
              title: item.title,
              url: item.url,
              score: item.score,
              publishedDate: item.publishedDate,
            };
          })
        : [],
      usage: value.usage,
    };
  }
  if (toolName === "web_extract") {
    return {
      results: Array.isArray(value.results)
        ? value.results.slice(0, 5).map((result) => {
            const item = record(result);
            return {
              url: item.url,
              contentLength: typeof item.content === "string" ? item.content.length : 0,
            };
          })
        : [],
      failedUrls: value.failedUrls,
      usage: value.usage,
    };
  }
  return redact(output);
}

export function projectEveEvent(event: unknown): ProjectedEvent | null {
  const source = record(event);
  const type = typeof source.type === "string" ? source.type : "";
  const data = record(source.data);
  if (!type || type.startsWith("reasoning.")) return null;

  if (type === "actions.requested") {
    const actions = Array.isArray(data.actions) ? data.actions.map(record) : [];
    const toolNames = actions.map((action) => String(action.toolName ?? ""));
    return {
      type: actions.some((action) => action.kind === "load-skill")
        ? "skill.loaded"
        : actions.some((action) => action.kind === "subagent-call")
          ? "subagent.started"
          : toolNames.includes("read_file")
            ? "file.read"
            : toolNames.includes("write_file")
              ? "file.written"
          : "tool.started",
      summary: actions.map(actionSummary).join("; ") || "Action requested",
      payload: { actions: redact(actions) as unknown[] },
      runStatus: "running",
    };
  }

  if (type === "action.result") {
    const result = record(data.result);
    const toolName = String(result.toolName ?? result.name ?? result.subagentName ?? "action");
    const failed = data.status === "failed" || result.isError === true || Boolean(data.error);
    const publishedReport =
      toolName === "publish_artifacts" &&
      JSON.stringify(result.output ?? "").includes("report.md");
    return {
      type:
        result.kind === "load-skill-result"
          ? "skill.loaded"
          : result.kind === "subagent-result"
            ? "subagent.completed"
            : publishedReport
              ? "report.published"
              : toolName === "read_file"
                ? "file.read"
                : toolName === "write_file"
                  ? "file.written"
            : failed
              ? "tool.failed"
              : "tool.completed",
      summary: `${failed ? "Failed" : "Completed"}: ${toolName}`,
      payload: redact({
        status: data.status,
        result: {
          kind: result.kind,
          callId: result.callId,
          toolName,
          isError: result.isError,
          output: summarizeToolOutput(toolName, result.output),
        },
        error: data.error,
      }) as JsonRecord,
      runStatus: failed ? undefined : "running",
    };
  }

  if (type === "message.completed") {
    return {
      type: "assistant.message",
      summary: "Assistant message completed",
      payload: redact({
        message: data.message ?? data.text ?? data.messageSoFar,
        finishReason: data.finishReason,
      }) as JsonRecord,
    };
  }

  if (type === "subagent.called" || type === "subagent.started") {
    return {
      type: "subagent.started",
      summary: `Subagent started: ${String(data.name ?? data.subagentName ?? "child")}`,
      payload: redact(data) as JsonRecord,
      runStatus: "running",
    };
  }

  if (type === "subagent.completed") {
    return {
      type: "subagent.completed",
      summary: `Subagent completed: ${String(data.name ?? data.subagentName ?? "child")}`,
      payload: redact(data) as JsonRecord,
      runStatus: "running",
    };
  }

  if (type === "step.completed") {
    return {
      type: "usage.updated",
      summary: `Model step completed: ${String(data.finishReason ?? "unknown")}`,
      payload: redact({ usage: data.usage, finishReason: data.finishReason }) as JsonRecord,
    };
  }

  const mapping: Record<string, ProjectedEvent> = {
    "session.started": {
      type: "session.started",
      summary: "Research session started",
      payload: {},
      runStatus: "running",
    },
    "turn.started": {
      type: "turn.started",
      summary: "Research turn started",
      payload: {},
      runStatus: "running",
    },
    "session.waiting": {
      type: "session.waiting",
      summary: "Session is waiting for feedback",
      payload: {},
      runStatus: "waiting",
    },
    "session.completed": {
      type: "session.completed",
      summary: "Research session completed",
      payload: {},
      runStatus: "completed",
    },
    "session.failed": {
      type: "session.failed",
      summary: "Research session failed",
      payload: redact({ code: data.code, message: data.message }) as JsonRecord,
      runStatus: "failed",
    },
    "turn.failed": {
      type: "turn.failed",
      summary: String(data.message ?? "Research turn failed"),
      payload: redact({ code: data.code, message: data.message, details: data.details }) as JsonRecord,
      runStatus: "failed",
    },
    "turn.cancelled": {
      type: "turn.cancelled",
      summary: "Research turn cancelled",
      payload: {},
      runStatus: "cancelled",
    },
    "step.failed": {
      type: "step.failed",
      summary: String(data.message ?? "Model step failed"),
      payload: redact({ code: data.code, message: data.message, details: data.details }) as JsonRecord,
      runStatus: "failed",
    },
  };
  const projected = mapping[type];
  return projected ? { ...projected, payload: { ...projected.payload, sequence: data.sequence } } : null;
}
