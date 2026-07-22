import { NextResponse } from "next/server";
import { interruptVoiceChat, type RtcAgentSession } from "@/lib/volcRtcAgent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = (await request.json()) as Pick<
      RtcAgentSession,
      "appId" | "roomId" | "taskId"
    >;
    const result = await interruptVoiceChat(session);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UpdateVoiceChat interrupt failed" },
      { status: 500 }
    );
  }
}
