import { NextResponse } from "next/server";
import { createSignedUploadUrl, createVideoObjectKey } from "@/lib/cos";

export const runtime = "nodejs";

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/ogg",
]);

const normalizeMimeType = (contentType: string | null): string => {
  if (!contentType) return "video/mp4";
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return "video/mp4";
  return ALLOWED_VIDEO_MIME_TYPES.has(normalized) ? normalized : "video/mp4";
};

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "video file is required" }, { status: 400 });
      }

      const mimeType = normalizeMimeType(file.type || contentType);
      const objectKey = createVideoObjectKey(file.name || "student-video.mp4");
      const uploadUrl = createSignedUploadUrl(objectKey);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
        },
        body: file.stream(),
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      if (!uploadResponse.ok) {
        return NextResponse.json(
          { error: `上传到 COS 失败：${uploadResponse.status}` },
          { status: 502 }
        );
      }

      return NextResponse.json({
        objectKey,
      });
    }

    const body = (await req.json()) as {
      fileName?: string;
      mimeType?: string;
    };
    const fileName = body.fileName?.trim();

    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }

    const mimeType = normalizeMimeType(body.mimeType || null);
    const objectKey = createVideoObjectKey(fileName);
    const uploadUrl = createSignedUploadUrl(objectKey);

    return NextResponse.json({
      objectKey,
      uploadUrl,
      mimeType,
    });
  } catch (error) {
    console.error("Upload API error:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}
