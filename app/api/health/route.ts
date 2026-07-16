import { NextResponse } from "next/server";

import { publicRuntimeConfig, resolveRuntimeConfig } from "@/src/config";

export const runtime = "nodejs";

export function GET() {
  try {
    return NextResponse.json({
      ok: true,
      service: "vercel-eve-demo",
      config: publicRuntimeConfig(resolveRuntimeConfig()),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "vercel-eve-demo",
        error: error instanceof Error ? error.message : "配置无效",
      },
      { status: 503 },
    );
  }
}
