import { NextRequest, NextResponse } from "next/server";

import { resolveOwnedRun } from "@/src/runs/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifactId: string }> },
) {
  const { runId, artifactId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  if (!owned) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const artifact = await owned.repository.findArtifact(runId, artifactId);
  if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  if (request.nextUrl.searchParams.get("download") === "1") {
    const filename = artifact.path.split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "_") || "artifact.md";
    return new NextResponse(artifact.content, {
      headers: {
        "Content-Type": artifact.mediaType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.json({ artifact });
}
