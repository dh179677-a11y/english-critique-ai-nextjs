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
      sectionType?: string;
      studentName?: string;
      bookName?: string;
      homeworkType?: string;
      tutorName?: string;
    };

    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json({ error: "Missing video URL" }, { status: 400 });
    }

    if (
      sectionType !== "highlights" &&
      sectionType !== "pronunciation" &&
      sectionType !== "grammar"
    ) {
      return NextResponse.json({ error: "Invalid section type" }, { status: 400 });
    }

    const metadata: VideoMetadata = {
      studentName: studentName?.trim() || undefined,
      bookName: bookName?.trim() || undefined,
      homeworkType: homeworkType?.trim() || undefined,
      tutorName: tutorName?.trim() || undefined,
    };

    const content = await regenerateFeedbackSection(
      videoUrl,
      sectionType as SectionType,
      metadata
    );

    return NextResponse.json({ content });
  } catch (error) {
    console.error("Regenerate API error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate feedback section" },
      { status: 500 }
    );
  }
}