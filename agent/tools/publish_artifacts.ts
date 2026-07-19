import { defineTool } from "eve/tools";
import { z } from "zod";

import { ResearchRepository } from "../../src/storage/repositories";
import { getDatabaseClient } from "../../src/storage/server";
import { authorizeRuntimeCapability } from "../../src/security/runtime_authorization";

const markdownPath = /^[A-Za-z0-9._/-]+\.md$/;
const inputSchema = z.object({
  paths: z.array(z.string().max(240).regex(markdownPath)).min(1).max(20),
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
    const client = getDatabaseClient();
    const repository = new ResearchRepository(client);
    const { runId } = await authorizeRuntimeCapability(context, client);
    const sandbox = await context.getSandbox();
    const artifacts = [];
    for (const path of input.paths) {
      if (path.startsWith("/") || path.split("/").includes("..")) {
        throw new Error("Artifact path must stay inside the workspace");
      }
      const content = await sandbox.readTextFile({ path });
      if (content === null) throw new Error(`Workspace file not found: ${path}`);
      const previous = await repository.findLatestArtifact(runId, path);
      const stored = await repository.storeArtifact({
        runId,
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
