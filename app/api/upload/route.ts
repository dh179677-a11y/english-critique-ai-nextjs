import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

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

const assertBlobTokenIsValid = () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is missing");
  }

  // Vercel Blob token should be ASCII only. Non-ASCII usually means a placeholder like "你的VercelBlobToken".
  if (/[\u0080-\uFFFF]/.test(token)) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is invalid: non-ASCII characters detected"
    );
  }
};

const getSafeExtension = (contentType: string | null, extHeader: string | null) => {
  if (extHeader) {
    const safe = extHeader.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (safe) return `.${safe}`;
  }

  switch (normalizeMimeType(contentType)) {
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    case "video/webm":
      return ".webm";
    case "video/x-matroska":
      return ".mkv";
    case "video/ogg":
      return ".ogv";
    default:
      return ".mp4";
  }
};

export async function POST(req: Request) {
  try {
    assertBlobTokenIsValid();

    const requestContentType = req.headers.get("content-type");
    const extHeader = req.headers.get("x-upload-ext");
    const safeMimeType = normalizeMimeType(requestContentType);
    const ext = getSafeExtension(safeMimeType, extHeader);
    const safeFilename = `video-${Date.now()}${ext}`;

    const arrayBuffer = await req.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const blob = await put(safeFilename, fileBuffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: safeMimeType,
    });

    return NextResponse.json({ url: blob.url });
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
