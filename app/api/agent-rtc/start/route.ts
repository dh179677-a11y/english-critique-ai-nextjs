import { NextResponse } from "next/server";
import { startVoiceChat, type RtcAgentStartRequest } from "@/lib/volcRtcAgent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = (await request.json()) as RtcAgentStartRequest;
    const result = await startVoiceChat(session);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "StartVoiceChat failed" },
      { status: 500 }
    );
  }
}
