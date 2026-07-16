import { defineTool } from "eve/tools";
import { z } from "zod";

import { ResearchRepository } from "../../src/storage/repositories";
import { getDatabaseClient } from "../../src/storage/server";

const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.md$/;
const inputSchema = z.object({
  paths: z.array(z.string().max(240).regex(safePath)).min(1).max(20),
});
const outputSchema = z.object({
  artifacts: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      contentHash: z.string(),
      sizeBytes: z.number(),
    }),
  ),
});

export default defineTool({
  description:
    "Checkpoint selected Markdown workspace files to the Workbench artifact store. Call this after meaningful research milestones and always include report.md before finishing.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const repository = new ResearchRepository(getDatabaseClient());
    const rootSessionId = context.session.parent?.rootSessionId ?? context.session.id;
    const run = await repository.findRunByEveSession(rootSessionId);
    if (!run) throw new Error("No Workbench run is mapped to this Eve session");
    const sandbox = await context.getSandbox();
    const artifacts = [];
    for (const path of input.paths) {
      const content = await sandbox.readTextFile({ path });
      if (content === null) throw new Error(`Workspace file not found: ${path}`);
      const previous = await repository.findLatestArtifact(String(run.id), path);
      const stored = await repository.storeArtifact({
        runId: String(run.id),
        path,
        mediaType: "text/markdown",
        content,
        parentArtifactId: previous ? String(previous.id) : undefined,
      });
      artifacts.push({ path, ...stored });
    }
    return { artifacts };
  },
});
