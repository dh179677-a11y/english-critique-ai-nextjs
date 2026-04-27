import { NextResponse } from "next/server";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { objectKey?: string };
    const objectKey = body.objectKey?.trim();

    if (!objectKey) {
      return NextResponse.json({ error: "objectKey is required" }, { status: 400 });
    }

    return NextResponse.json({
      url: createSignedDownloadUrl(objectKey),
    });
  } catch (error) {
    console.error("Video URL route error:", error);
    return NextResponse.json({ error: "视频地址生成失败" }, { status: 500 });
  }
}
