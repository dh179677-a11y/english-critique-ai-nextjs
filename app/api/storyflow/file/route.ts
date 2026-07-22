import { NextResponse } from "next/server";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

const isLikelyImageKey = (objectKey: string) =>
  /\.(?:jpg|jpeg|png|webp|gif|avif|svg)$/i.test(objectKey);

const buildUnavailableImageSvg = (status: number, message: string) => {
  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" rx="36" fill="#eef7ff"/>
  <rect x="70" y="70" width="1060" height="660" rx="32" fill="#ffffff" stroke="#bde3ff" stroke-width="6"/>
  <text x="600" y="345" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#0f2748">图片暂时无法读取</text>
  <text x="600" y="420" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#64748b">云存储返回 ${status}</text>
  <text x="600" y="475" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#94a3b8">${safeMessage}</text>
</svg>`;
};

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
      if (isLikelyImageKey(objectKey)) {
        const errorText = await upstream.text().catch(() => "");
        const message = /account is arrears/i.test(errorText)
          ? "COS账号欠费或存储不可用，恢复后会自动显示"
          : "请检查云存储文件或重新上传图片";

        return new NextResponse(buildUnavailableImageSvg(upstream.status, message), {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

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
