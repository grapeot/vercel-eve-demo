import { describe, expect, it } from "vitest";

import { projectEveEvent } from "@/src/events/projector";

describe("Eve event projector", () => {
  it("drops hidden reasoning and redacts secret-shaped fields", () => {
    expect(
      projectEveEvent({ type: "reasoning.completed", data: { reasoning: "private" } }),
    ).toBeNull();
    const projected = projectEveEvent({
      type: "actions.requested",
      data: {
        actions: [
          {
            kind: "tool-call",
            toolName: "web_search",
            callId: "call-1",
            input: { query: "public", authorization: "private" },
          },
        ],
      },
    });
    expect(JSON.stringify(projected)).toContain("[REDACTED]");
    expect(JSON.stringify(projected)).not.toContain("private");
  });

  it("keeps extract provenance without storing full page content", () => {
    const projected = projectEveEvent({
      type: "action.result",
      data: {
        status: "completed",
        result: {
          kind: "tool-result",
          toolName: "web_extract",
          callId: "call-1",
          output: {
            results: [
              { url: "https://example.com", content: "sensitive page text".repeat(100) },
            ],
            usage: { units: 2 },
          },
        },
      },
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).toContain("contentLength");
    expect(serialized).toContain("https://example.com");
    expect(serialized).not.toContain("sensitive page text");
  });

  it("projects report publication and session state", () => {
    expect(
      projectEveEvent({
        type: "action.result",
        data: {
          status: "completed",
          result: {
            kind: "tool-result",
            toolName: "publish_artifacts",
            output: { artifacts: [{ path: "report.md" }] },
          },
        },
      })?.type,
    ).toBe("report.published");
    expect(
      projectEveEvent({ type: "session.waiting", data: { continuationToken: "secret" } }),
    ).toMatchObject({ type: "session.waiting", runStatus: "waiting", payload: {} });
  });
});
