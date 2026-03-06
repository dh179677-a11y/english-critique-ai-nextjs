import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
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

const sanitizePathname = (pathname: string) => {
  const normalized = pathname.replace(/\\/g, "/").trim();
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  const safe = withoutLeadingSlash.replace(/[^a-zA-Z0-9/_\-.]/g, "");
  return safe || `video-${Date.now()}.mp4`;
};

export async function POST(req: Request) {
  try {
    assertBlobTokenIsValid();
    const body = (await req.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = clientPayload
          ? (JSON.parse(clientPayload) as { mimeType?: string })
          : {};
        const safeMimeType = normalizeMimeType(payload.mimeType || null);

        return {
          allowedContentTypes: [safeMimeType],
          addRandomSuffix: true,
          pathname: sanitizePathname(pathname),
        };
      },
      onUploadCompleted: async () => {
        // no-op
      },
    });

    return NextResponse.json(jsonResponse);
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
