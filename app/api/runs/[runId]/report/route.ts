import { NextRequest, NextResponse } from "next/server";

import { resolveOwnedRun } from "@/src/runs/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const report = await owned.repository.findLatestArtifact(runId, "report.md");
  return report
    ? NextResponse.json({
        artifact: {
          id: String(report.id),
          path: String(report.path),
          mediaType: String(report.media_type),
          contentHash: String(report.content_hash),
          content: String(report.content),
          sizeBytes: Number(report.size_bytes),
          createdAt: String(report.created_at),
        },
      })
    : NextResponse.json({ error: "Report not found" }, { status: 404 });
}
