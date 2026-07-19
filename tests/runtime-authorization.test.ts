import { createClient } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authorizeRuntimeCapability } from "@/src/security/runtime_authorization";
import {
  AccessSessionRepository,
  ResearchRepository,
} from "@/src/storage/repositories";
import { migrateDatabase } from "@/src/storage/schema";

describe("runtime capability authorization", () => {
  let client: ReturnType<typeof createClient>;
  let access: AccessSessionRepository;
  let research: ResearchRepository;
  let runId: string;

  const context = {
    session: {
      id: "eve-runtime-session",
      auth: {
        initiator: { principalId: "access-runtime" },
        current: { principalId: "access-runtime" },
      },
    },
  };

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await migrateDatabase(client);
    access = new AccessSessionRepository(client);
    research = new ResearchRepository(client);
    await access.create({
      id: "access-runtime",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const requestId = await research.createRequest({
      accessSessionId: "access-runtime",
      question: "Is this capability still authorized?",
    });
    runId = await research.createRun({
      requestId,
      workspaceId: "workspace-runtime-auth",
      skillBundleVersion: "bundle-v1",
    });
    await research.attachSession({
      runId,
      accessSessionId: "access-runtime",
      eveSessionId: "eve-runtime-session",
    });
  });

  afterEach(() => client.close());

  it("revalidates the active access session and run ownership", async () => {
    await expect(authorizeRuntimeCapability(context, client)).resolves.toEqual({
      accessSessionId: "access-runtime",
      runId,
      rootSessionId: "eve-runtime-session",
    });
  });

  it("fails closed and cancels the run after access is revoked", async () => {
    await access.revoke("access-runtime");

    await expect(authorizeRuntimeCapability(context, client)).rejects.toThrow(
      "Runtime authorization is unavailable or no longer active",
    );
    expect(await research.findRunByEveSession("eve-runtime-session")).toMatchObject({
      status: "cancelled",
    });
  });

  it("fails closed and cancels the run on principal substitution", async () => {
    await expect(
      authorizeRuntimeCapability(
        {
          session: {
            ...context.session,
            auth: {
              ...context.session.auth,
              current: { principalId: "substituted-principal" },
            },
          },
        },
        client,
      ),
    ).rejects.toThrow("Runtime authorization is unavailable or no longer active");
    expect(await research.findRunByEveSession("eve-runtime-session")).toMatchObject({
      status: "cancelled",
    });
  });

  it("fails closed when the authorization database is unavailable", async () => {
    client.close();
    await expect(authorizeRuntimeCapability(context, client)).rejects.toThrow(
      "Runtime authorization is unavailable or no longer active",
    );
  });
});
