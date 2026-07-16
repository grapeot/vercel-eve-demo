import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveOwnedRun } from "@/src/runs/access";

const attachSchema = z.object({ eveSessionId: z.string().min(1).max(200) });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const [events, artifacts] = await Promise.all([
    owned.repository.listEvents(runId),
    owned.repository.listArtifacts(runId),
  ]);
  return NextResponse.json({ run: owned.run, events, artifacts });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  const input = attachSchema.safeParse(await request.json().catch(() => null));
  if (!owned || !input.success) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const attached = await owned.repository.attachSession({
    runId,
    accessSessionId: owned.owner.accessSessionId,
    eveSessionId: input.data.eveSessionId,
  });
  return attached
    ? NextResponse.json({ attached: true })
    : NextResponse.json({ error: "Session mapping conflict" }, { status: 409 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  await owned.repository.setRunStatus(runId, "cancelled");
  return NextResponse.json({ cancelled: true });
}
