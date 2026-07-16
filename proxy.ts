import { NextRequest, NextResponse } from "next/server";

import { authenticateOwnerRequest } from "@/src/security/request";

function reject(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Access denied" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/access", request.url));
}

export async function proxy(request: NextRequest) {
  try {
    return (await authenticateOwnerRequest(request))
      ? NextResponse.next()
      : reject(request);
  } catch {
    return reject(request);
  }
}

export const config = {
  matcher: [
    "/((?!access$|api/access/challenge|_next/static|_next/image|favicon.ico).*)",
  ],
};
