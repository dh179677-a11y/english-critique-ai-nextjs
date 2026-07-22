import { NextResponse } from "next/server";
import { createRtcAgentSession } from "@/lib/volcRtcAgent";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = createRtcAgentSession();
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "RTC session failed" },
      { status: 500 }
    );
  }
}
