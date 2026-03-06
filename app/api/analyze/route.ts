import { NextResponse } from "next/server";
import { analyzeStudentVideo, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { videoUrl, studentName, bookName, homeworkType, tutorName } =
      body as {
      videoUrl?: string;
      studentName?: string;
      bookName?: string;
      homeworkType?: string;
      tutorName?: string;
    };

    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json({ error: "Missing video URL" }, { status: 400 });
    }

    const metadata: VideoMetadata = {
      studentName: studentName?.trim() || undefined,
      bookName: bookName?.trim() || undefined,
      homeworkType: homeworkType?.trim() || undefined,
      tutorName: tutorName?.trim() || undefined,
    };

    const result = await analyzeStudentVideo(videoUrl, metadata);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze API error:", error);
    return NextResponse.json(
      { error: "Failed to analyze video" },
      { status: 500 }
    );
  }
}
