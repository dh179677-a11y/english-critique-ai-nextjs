import { NextResponse } from "next/server";
import { createCosObjectKey, createSignedUploadUrl } from "@/lib/cos";

export const runtime = "nodejs";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
]);

type UploadKind = "source" | "page" | "audio";

const getUploadKind = (value: unknown): UploadKind =>
  value === "source" ? "source" : value === "audio" ? "audio" : "page";

const normalizeMimeType = (contentType: string | null): string => {
  if (!contentType) return "application/octet-stream";
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return "application/octet-stream";
  return ALLOWED_MIME_TYPES.has(normalized)
    ? normalized
    : "application/octet-stream";
};

const resolveFolder = (kind: UploadKind, mimeType: string) => {
  if (kind === "source" && mimeType === "application/pdf") {
    return "storyflow/source-pdf";
  }
  if (kind === "source") {
    return "storyflow/source-image";
  }
  if (kind === "audio") {
    return "storyflow/audio";
  }
  return "storyflow/pages";
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fileName?: string;
      mimeType?: string;
      uploadKind?: unknown;
    };

    const fileName = body.fileName?.trim();
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }

    const mimeType = normalizeMimeType(body.mimeType || null);
    if (mimeType === "application/octet-stream") {
      return NextResponse.json({ error: "unsupported mimeType" }, { status: 400 });
    }

    const uploadKind = getUploadKind(body.uploadKind);
    const objectKey = createCosObjectKey(resolveFolder(uploadKind, mimeType), fileName);
    const uploadUrl = createSignedUploadUrl(objectKey);

    return NextResponse.json({
      objectKey,
      uploadUrl,
      mimeType,
    });
  } catch (error) {
    console.error("Storyflow upload API error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}
