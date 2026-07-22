import { NextResponse } from "next/server";
import { sendExternalTextToLlm, type RtcAgentSession } from "@/lib/volcRtcAgent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Pick<
      RtcAgentSession,
      "appId" | "roomId" | "taskId"
    > & { message?: string };
    const message = payload.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const result = await sendExternalTextToLlm(payload, message);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UpdateVoiceChat ExternalTextToLLM failed" },
      { status: 500 }
    );
  }
}
