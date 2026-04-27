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
