import { createHash } from "node:crypto";

import { projectEveEvent, type ProjectedEvent } from "./projector";
import type { ResearchRepository } from "../storage/repositories";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createSourceEventKey(input: {
  sourceSessionId: string;
  sourceCreatedAt: string;
  projected: ProjectedEvent;
}): string {
  return createHash("sha256")
    .update(input.sourceSessionId)
    .update("\0")
    .update(input.sourceCreatedAt)
    .update("\0")
    .update(input.projected.type)
    .update("\0")
    .update(canonicalJson(input.projected))
    .digest("base64url");
}

export async function persistRootEveEvent(input: {
  repository: ResearchRepository;
  event: unknown;
  session: {
    id: string;
    auth: {
      initiator: { principalId: string } | null;
      current: { principalId: string } | null;
    };
    parent?: { sessionId: string };
    turn?: unknown;
  };
}): Promise<boolean> {
  if (input.session.parent) return false;
  const event = record(input.event);
  const eventType = typeof event.type === "string" ? event.type : "";
  const meta = record(event.meta);
  const sourceCreatedAt =
    typeof meta.at === "string"
      ? meta.at
      : `unstamped:${createHash("sha256")
          .update(canonicalJson({ event: input.event, turn: input.session.turn }))
          .digest("base64url")}`;
  if (!eventType) return false;

  const initiator = input.session.auth.initiator;
  const current = input.session.auth.current;
  if (!initiator || !current || initiator.principalId !== current.principalId) {
    return false;
  }
  let run = await input.repository.findRunByEveSession(input.session.id);
  if (!run) {
    await input.repository.attachQueuedSession({
      accessSessionId: initiator.principalId,
      eveSessionId: input.session.id,
    });
    run = await input.repository.findRunByEveSession(input.session.id);
  }

  const projected = projectEveEvent(input.event);
  if (!run || !projected) return false;
  return input.repository.appendProjectedEvent({
    runId: String(run.id),
    sourceSessionId: input.session.id,
    sourceEventKey: createSourceEventKey({
      sourceSessionId: input.session.id,
      sourceCreatedAt,
      projected,
    }),
    sourceCreatedAt,
    type: projected.type,
    summary: projected.summary,
    payload: projected.payload,
    runStatus: projected.runStatus,
  });
}
