import { NextResponse } from "next/server";
import { analyzeStudentVideo, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { transcript, studentName, bookName, homeworkType, tutorName } =
      body as {
        transcript?: string;
        studentName?: string;
        bookName?: string;
        homeworkType?: string;
        tutorName?: string;
      };

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { error: "transcript is required" },
        { status: 400 }
      );
    }

    const metadata: VideoMetadata = {
      studentName,
      bookName,
      homeworkType,
      tutorName,
    };

    const result = await analyzeStudentVideo(transcript, metadata);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Analyze route error:", error);
    return NextResponse.json({ error: "分析失败" }, { status: 500 });
  }
}