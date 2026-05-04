import { NextResponse } from "next/server";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const objectKey = searchParams.get("key")?.trim();

    if (!objectKey) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const upstream = await fetch(createSignedDownloadUrl(objectKey), {
      method: "GET",
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `文件读取失败：${upstream.status}` },
        { status: upstream.status }
      );
    }

    const buffer = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Storyflow file proxy error:", error);
    return NextResponse.json({ error: "文件代理失败" }, { status: 500 });
  }
}
