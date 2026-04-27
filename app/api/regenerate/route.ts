import { NextResponse } from "next/server";
import { regenerateFeedbackSection, VideoMetadata } from "@/lib/gemini";
import { createSignedDownloadUrl } from "@/lib/cos";

export const runtime = "nodejs";

type SectionType = "highlights" | "pronunciation" | "grammar";

type RegenerateRequestBody = {
  objectKey?: string;
  sectionType?: string;
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
    const body = (await request.json()) as RegenerateRequestBody;
    const objectKey = getStringValue(body.objectKey);
    const sectionType = getStringValue(body.sectionType);

    if (!objectKey) {
      return NextResponse.json({ error: "objectKey is required" }, { status: 400 });
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
      studentName: getStringValue(body.studentName),
      bookName: getStringValue(body.bookName),
      homeworkType: getStringValue(body.homeworkType),
      tutorName: getStringValue(body.tutorName),
    };
    const videoSource = createSignedDownloadUrl(objectKey);

    const result = await regenerateFeedbackSection(
      videoSource,
      sectionType as SectionType,
      metadata
    );

    return NextResponse.json({ content: result });
  } catch (error) {
    console.error("Regenerate route error:", error);
    return NextResponse.json({ error: "重写失败" }, { status: 500 });
  }
}
