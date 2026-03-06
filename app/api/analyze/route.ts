import { NextResponse } from "next/server";
import { analyzeStudentVideo, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

const getString = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const videoFile = formData.get("video");

    if (!(videoFile instanceof File)) {
      return NextResponse.json({ error: "Missing video file" }, { status: 400 });
    }

    const metadata: VideoMetadata = {
      studentName: getString(formData.get("studentName")),
      bookName: getString(formData.get("bookName")),
      homeworkType: getString(formData.get("homeworkType")),
      tutorName: getString(formData.get("tutorName")),
    };

    const result = await analyzeStudentVideo(videoFile, metadata);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze API error:", error);
    return NextResponse.json({ error: "Failed to analyze video" }, { status: 500 });
  }
}
