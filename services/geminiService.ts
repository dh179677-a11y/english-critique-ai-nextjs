import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

const buildAnalyzeFormData = (videoFile: File, metadata: VideoMetadata) => {
  const formData = new FormData();
  formData.append("video", videoFile);

  if (metadata.studentName) formData.append("studentName", metadata.studentName);
  if (metadata.bookName) formData.append("bookName", metadata.bookName);
  if (metadata.homeworkType) formData.append("homeworkType", metadata.homeworkType);
  if (metadata.tutorName) formData.append("tutorName", metadata.tutorName);

  return formData;
};

export const analyzeStudentVideo = async (
  videoFile: File,
  metadata: VideoMetadata = {}
): Promise<AnalysisResult> => {
  const response = await fetch("/api/analyze", {
    method: "POST",
    body: buildAnalyzeFormData(videoFile, metadata),
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
  const formData = buildAnalyzeFormData(videoFile, metadata);
  formData.append("sectionType", sectionType);

  const response = await fetch("/api/regenerate", {
    method: "POST",
    body: formData,
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
