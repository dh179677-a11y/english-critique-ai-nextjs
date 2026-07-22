import { NextResponse } from "next/server";
import { stopVoiceChat, type RtcAgentSession } from "@/lib/volcRtcAgent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = (await request.json()) as Pick<RtcAgentSession, "appId" | "roomId" | "taskId">;
    const result = await stopVoiceChat(session);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "StopVoiceChat failed" },
      { status: 500 }
    );
  }
}
