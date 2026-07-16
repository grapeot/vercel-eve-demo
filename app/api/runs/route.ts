import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SKILL_BUNDLE_VERSION } from "@/src/runs/version";
import { authenticateOwnerRequest } from "@/src/security/request";
import { ResearchRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

const createRunSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  context: z.string().trim().max(8000).optional(),
  constraints: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 401 });
  const runs = await new ResearchRepository(getDatabaseClient()).listOwnedRuns(
    owner.accessSessionId,
  );
  return NextResponse.json({ runs });
}

export async function POST(request: NextRequest) {
  const owner = await authenticateOwnerRequest(request);
  const input = createRunSchema.safeParse(await request.json().catch(() => null));
  if (!owner || !input.success) {
    return NextResponse.json({ error: "Invalid research request" }, { status: 400 });
  }
  const repository = new ResearchRepository(getDatabaseClient());
  const active = (await repository.listOwnedRuns(owner.accessSessionId, 20)).find(
    (run) =>
      run.status === "queued" || run.status === "running" || run.status === "waiting",
  );
  if (active) {
    return NextResponse.json(
      { error: "Another research run is active", runId: String(active.id) },
      { status: 409 },
    );
  }
  const requestId = await repository.createRequest({
    accessSessionId: owner.accessSessionId,
    question: input.data.question,
    context: input.data.context,
    constraints: input.data.constraints,
  });
  const workspaceId = randomUUID();
  const runId = await repository.createRun({
    requestId,
    workspaceId,
    skillBundleVersion: SKILL_BUNDLE_VERSION,
  });
  return NextResponse.json({ runId, workspaceId }, { status: 201 });
}
