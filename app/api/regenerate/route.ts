import { NextResponse } from "next/server";
import { regenerateFeedbackSection, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

type SectionType = "highlights" | "pronunciation" | "grammar";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      videoUrl,
      sectionType,
      studentName,
      bookName,
      homeworkType,
      tutorName,
    } = body as {
      videoUrl?: string;
      sectionType?: SectionType;
      studentName?: string;
      bookName?: string;
      homeworkType?: string;
      tutorName?: string;
    };

    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json(
        { error: "videoUrl is required" },
        { status: 400 }
      );
    }

    if (
      !sectionType ||
      !["highlights", "pronunciation", "grammar"].includes(sectionType)
    ) {
      return NextResponse.json(
        { error: "invalid sectionType" },
        { status: 400 }
      );
    }

    const metadata: VideoMetadata = {
      studentName: studentName?.trim() || undefined,
      bookName: bookName?.trim() || undefined,
      homeworkType: homeworkType?.trim() || undefined,
      tutorName: tutorName?.trim() || undefined,
    };

    const result = await regenerateFeedbackSection(
      videoUrl,
      sectionType,
      metadata
    );

    return NextResponse.json({ content: result });
  } catch (error) {
    console.error("Regenerate route error:", error);
    return NextResponse.json({ error: "重写失败" }, { status: 500 });
  }
}
