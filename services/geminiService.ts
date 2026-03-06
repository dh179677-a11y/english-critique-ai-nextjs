import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

const appendMetadata = (formData: FormData, metadata: VideoMetadata) => {
  if (metadata.studentName) formData.append("studentName", metadata.studentName);
  if (metadata.bookName) formData.append("bookName", metadata.bookName);
  if (metadata.homeworkType) formData.append("homeworkType", metadata.homeworkType);
  if (metadata.tutorName) formData.append("tutorName", metadata.tutorName);
};

export const analyzeStudentVideo = async (
  videoFile: File,
  metadata: VideoMetadata = {},
): Promise<AnalysisResult> => {
  const formData = new FormData();
  formData.append("video", videoFile);
  appendMetadata(formData, metadata);

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Analyze request failed");
  }

  return (await response.json()) as AnalysisResult;
};

export const regenerateFeedbackSection = async (
  videoFile: File,
  sectionType: SectionType,
  metadata: VideoMetadata,
): Promise<string> => {
  const formData = new FormData();
  formData.append("video", videoFile);
  formData.append("sectionType", sectionType);
  appendMetadata(formData, metadata);

  const response = await fetch("/api/regenerate", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Regenerate request failed");
  }

  const data = (await response.json()) as { content?: string };
  return data.content || "";
};
