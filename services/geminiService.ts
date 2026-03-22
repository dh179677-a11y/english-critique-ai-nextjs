import { AnalysisResult } from "@/types";
import { upload } from "@vercel/blob/client";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/ogg",
]);

const getSafeUploadMimeType = (mimeType: string): string => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return "video/mp4";
  return ALLOWED_UPLOAD_MIME_TYPES.has(normalized) ? normalized : "video/mp4";
};

const getSafeUploadExt = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
};

const uploadVideo = async (videoFile: File): Promise<string> => {
  const safeMimeType = getSafeUploadMimeType(videoFile.type);
  const safeExt = getSafeUploadExt(videoFile.name);
  const pathname = `videos/video-${Date.now()}${safeExt ? `.${safeExt}` : ".mp4"}`;

  const blob = await upload(pathname, videoFile, {
    access: "public",
    handleUploadUrl: "/api/upload",
    clientPayload: JSON.stringify({ mimeType: safeMimeType }),
  });

  return blob.url;
};

export const analyzeStudentVideo = async (
  videoFile: File,
  metadata: VideoMetadata = {}
): Promise<AnalysisResult> => {
  const videoUrl = await uploadVideo(videoFile);

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoUrl,
      ...metadata,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = text || "Analyze request failed";

    try {
      const data = JSON.parse(text) as { error?: string };
      errorMessage = data.error || errorMessage;
    } catch {
      // Keep raw text when the server did not return JSON.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as AnalysisResult;
};

export const regenerateFeedbackSection = async (
  videoFile: File,
  sectionType: SectionType,
  metadata: VideoMetadata
): Promise<string> => {
  const videoUrl = await uploadVideo(videoFile);

  const response = await fetch("/api/regenerate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoUrl,
      sectionType,
      ...metadata,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = text || "Regenerate request failed";

    try {
      const data = JSON.parse(text) as { error?: string };
      errorMessage = data.error || errorMessage;
    } catch {
      // Keep raw text when the server did not return JSON.
    }

    throw new Error(errorMessage);
  }

  const data = (await response.json()) as { content?: string };
  return data.content || "";
};
