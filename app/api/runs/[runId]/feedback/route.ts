import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveOwnedRun } from "@/src/runs/access";

const feedbackSchema = z.object({
  artifactId: z.string().min(1).optional(),
  reportContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  selectedText: z.string().max(4000).optional(),
  feedbackText: z.string().trim().min(1).max(8000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const owned = await resolveOwnedRun(request, runId);
  const input = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!owned || !input.success) {
    return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
  }
  if (input.data.artifactId) {
    const artifact = await owned.repository.findArtifact(runId, input.data.artifactId);
    if (!artifact || artifact.contentHash !== input.data.reportContentHash) {
      return NextResponse.json({ error: "Feedback anchor is stale" }, { status: 409 });
    }
  }
  const feedbackId = await owned.repository.addFeedback({
    runId,
    artifactId: input.data.artifactId,
    reportContentHash: input.data.reportContentHash,
    selectedText: input.data.selectedText,
    feedbackText: input.data.feedbackText,
  });
  return NextResponse.json({ feedbackId }, { status: 201 });
}
