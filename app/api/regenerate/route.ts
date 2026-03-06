import { NextResponse } from "next/server";
import { regenerateFeedbackSection, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

type SectionType = "highlights" | "pronunciation" | "grammar";

const getString = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const isSectionType = (value: string): value is SectionType => {
  return value === "highlights" || value === "pronunciation" || value === "grammar";
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const videoFile = formData.get("video");
    const sectionTypeValue = formData.get("sectionType");

    if (!(videoFile instanceof File)) {
      return NextResponse.json({ error: "Missing video file" }, { status: 400 });
    }

    if (typeof sectionTypeValue !== "string" || !isSectionType(sectionTypeValue)) {
      return NextResponse.json({ error: "Invalid sectionType" }, { status: 400 });
    }

    const metadata: VideoMetadata = {
      studentName: getString(formData.get("studentName")),
      bookName: getString(formData.get("bookName")),
      homeworkType: getString(formData.get("homeworkType")),
      tutorName: getString(formData.get("tutorName")),
    };

    const content = await regenerateFeedbackSection(videoFile, sectionTypeValue, metadata);
    return NextResponse.json({ content });
  } catch (error) {
    console.error("Regenerate API error:", error);
    return NextResponse.json({ error: "Failed to regenerate section" }, { status: 500 });
  }
}
