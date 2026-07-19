import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ACCESS_COOKIE_NAME } from "@/src/security/config";
import { authenticateOwnerRequest } from "@/src/security/request";
import { OwnerDataRepository } from "@/src/storage/repositories";
import { getDatabaseClient } from "@/src/storage/server";

const OWNER_PURGE_CONFIRMATION = "PURGE OWNER DATA";

const inputSchema = z.object({
  confirmation: z.literal(OWNER_PURGE_CONFIRMATION),
});

export async function DELETE(request: NextRequest) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner) return NextResponse.json({ error: "Access denied" }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "Exact purge confirmation required" }, { status: 400 });
  }

  await new OwnerDataRepository(getDatabaseClient()).purgeAll();
  const response = NextResponse.json({ purged: true });
  response.cookies.set(ACCESS_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
