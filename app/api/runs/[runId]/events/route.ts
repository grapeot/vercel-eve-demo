import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createSourceEventKey } from "@/src/events/durability";
import { projectEveEvent } from "@/src/events/projector";
import { resolveOwnedRun } from "@/src/runs/access";

const eventBatchSchema = z.object({
  sourceSessionId: z.string().min(1).max(200),
  startIndex: z.number().int().nonnegative(),
  events: z.array(z.unknown()).max(500),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const after = Number(request.nextUrl.searchParams.get("after") ?? -1);
  return NextResponse.json({
    events: await owned.repository.listEvents(
      runId,
      Number.isInteger(after) ? after : -1,
    ),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  const input = eventBatchSchema.safeParse(await request.json().catch(() => null));
  if (!owned || !input.success) {
    return NextResponse.json({ error: "Invalid event batch" }, { status: 400 });
  }
  if (String(owned.run.eve_session_id ?? "") !== input.data.sourceSessionId) {
    return NextResponse.json({ error: "Session mapping conflict" }, { status: 409 });
  }

  let persisted = 0;
  for (const [offset, event] of input.data.events.entries()) {
    const projected = projectEveEvent(event);
    if (!projected) continue;
    const sourceCreatedAt = `browser:${input.data.startIndex + offset}`;
    const inserted = await owned.repository.appendProjectedEvent({
      id: `${runId}:${input.data.sourceSessionId}:${sourceCreatedAt}`,
      runId,
      sourceSessionId: input.data.sourceSessionId,
      sourceEventKey: createSourceEventKey({
        sourceSessionId: input.data.sourceSessionId,
        sourceCreatedAt,
        projected,
      }),
      sourceCreatedAt,
      type: projected.type,
      summary: projected.summary,
      payload: projected.payload,
      runStatus: projected.runStatus,
    });
    if (inserted) persisted += 1;
  }
  return NextResponse.json({ persisted });
}
