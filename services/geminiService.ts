import { AnalysisResult } from "@/types";

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

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": safeMimeType,
      ...(safeExt ? { "x-upload-ext": safeExt } : {}),
    },
    body: videoFile,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${text}`);
  }

  const data = (await response.json()) as { url: string };
  return data.url;
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
    throw new Error(`Analyze request failed: ${text}`);
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
    throw new Error(`Regenerate request failed: ${text}`);
  }

  const data = (await response.json()) as { content?: string };
  return data.content || "";
};
