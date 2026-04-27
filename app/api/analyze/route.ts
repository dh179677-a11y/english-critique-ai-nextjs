import { NextResponse } from "next/server";
import { analyzeStudentVideo, VideoMetadata } from "@/lib/gemini";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

type AnalyzeRequestBody = {
  objectKey?: string;
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
};

const getStringValue = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequestBody;
    const objectKey = getStringValue(body.objectKey);

    if (!objectKey) {
      return NextResponse.json({ error: "objectKey is required" }, { status: 400 });
    }

    const metadata: VideoMetadata = {
      studentName: getStringValue(body.studentName),
      bookName: getStringValue(body.bookName),
      homeworkType: getStringValue(body.homeworkType),
      tutorName: getStringValue(body.tutorName),
    };

    const videoSource = createSignedDownloadUrl(objectKey);
    const result = await analyzeStudentVideo(videoSource, metadata);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze route error:", error);
    const message = error instanceof Error ? error.message : "分析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
