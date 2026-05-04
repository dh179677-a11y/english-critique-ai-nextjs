import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { objectKeys?: unknown };
    const objectKeys = Array.isArray(body.objectKeys)
      ? body.objectKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];

    if (!objectKeys.length) {
      return NextResponse.json({ error: "objectKeys is required" }, { status: 400 });
    }

    return NextResponse.json({
      urls: Object.fromEntries(
        objectKeys.map((objectKey) => [
          objectKey,
          `/api/storyflow/file?key=${encodeURIComponent(objectKey)}`,
        ])
      ),
    });
  } catch (error) {
    console.error("Storyflow URL route error:", error);
    return NextResponse.json({ error: "文件地址生成失败" }, { status: 500 });
  }
}
