import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

interface UploadVideoResponse {
  objectKey: string;
}

interface AnalyzeVideoResponse {
  result: AnalysisResult;
  objectKey: string;
}

const parseErrorMessage = async (response: Response, fallback: string) => {
  const text = await response.text();
  let errorMessage = text || fallback;

  try {
    const data = JSON.parse(text) as { error?: string };
    errorMessage = data.error || errorMessage;
  } catch {
    // Keep raw text when the server did not return JSON.
  }

  return errorMessage;
};

const requestUploadUrl = async (videoFile: File): Promise<UploadVideoResponse> => {
  const formData = new FormData();
  formData.append("file", videoFile);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Upload init failed"));
  }

  return (await response.json()) as UploadVideoResponse;
};

const uploadVideoFile = async (videoFile: File) => {
  const { objectKey } = await requestUploadUrl(videoFile);
  return objectKey;
};

export const analyzeStudentVideo = async (
  videoFile: File,
  metadata: VideoMetadata = {}
): Promise<AnalyzeVideoResponse> => {
  const objectKey = await uploadVideoFile(videoFile);
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey,
      ...metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Analyze request failed"));
  }

  return {
    result: (await response.json()) as AnalysisResult,
    objectKey,
  };
};

export const regenerateFeedbackSection = async (
  objectKey: string,
  sectionType: SectionType,
  metadata: VideoMetadata
): Promise<string> => {
  const response = await fetch("/api/regenerate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey,
      sectionType,
      ...metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, "Regenerate request failed")
    );
  }

  const data = (await response.json()) as { content?: string };
  return data.content || "";
};
