import { NextRequest, NextResponse } from "next/server";

import { authenticateOwnerRequest } from "@/src/security/request";
import { OWNER_CREDENTIAL_ID } from "@/src/codex/credentials";
import { OAuthCredentialRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

export async function GET(request: NextRequest) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 401 });
  const credential = await new OAuthCredentialRepository(
    getDatabaseClient(),
  ).findByOwner(OWNER_CREDENTIAL_ID);
  return NextResponse.json({
    enabled: process.env.CODEX_EXPERIMENT_ENABLED === "1",
    connected: credential?.status === "active",
    expiresAt: credential?.status === "active" ? credential.expiresAt : null,
    flow: process.env.VERCEL === "1" ? "device" : "browser",
  });
}
