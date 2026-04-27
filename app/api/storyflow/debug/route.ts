import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    console.log("[storyflow-debug]", JSON.stringify(payload));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[storyflow-debug-error]", error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
