import { NextResponse } from "next/server";
import { analyzeStudentVideo, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

const getStringValue = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const fileToDataUrl = async (file: File) => {
  const mimeType = file.type || "video/mp4";
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${mimeType};base64,${base64}`;
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const video = formData.get("video");

    if (!(video instanceof File)) {
      return NextResponse.json({ error: "video file is required" }, { status: 400 });
    }

    const videoSource = await fileToDataUrl(video);

    const metadata: VideoMetadata = {
      studentName: getStringValue(formData.get("studentName")),
      bookName: getStringValue(formData.get("bookName")),
      homeworkType: getStringValue(formData.get("homeworkType")),
      tutorName: getStringValue(formData.get("tutorName")),
    };

    const result = await analyzeStudentVideo(videoSource, metadata);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze route error:", error);
    const message = error instanceof Error ? error.message : "分析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
