import { NextRequest, NextResponse } from "next/server";

import { resolveOwnedRun } from "@/src/runs/access";

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
