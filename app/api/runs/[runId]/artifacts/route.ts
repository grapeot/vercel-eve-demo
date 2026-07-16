import { NextRequest, NextResponse } from "next/server";

import { resolveOwnedRun } from "@/src/runs/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ artifacts: await owned.repository.listArtifacts(runId) });
}
