import { authenticateOwnerRequest } from "@/src/security/request";
import { ResearchRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

export async function resolveOwnedRun(request: Request, runId: string) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner) return null;
  const repository = new ResearchRepository(getDatabaseClient());
  const run = await repository.findOwnedRun(runId, owner.accessSessionId);
  return run ? { owner, repository, run } : null;
}
