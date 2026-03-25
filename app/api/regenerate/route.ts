import { NextResponse } from "next/server";
import { regenerateFeedbackSection, VideoMetadata } from "@/lib/gemini";

export const runtime = "nodejs";

type SectionType = "highlights" | "pronunciation" | "grammar";

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
    const sectionType = getStringValue(formData.get("sectionType"));

    if (!(video instanceof File)) {
      return NextResponse.json({ error: "video file is required" }, { status: 400 });
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
      studentName: getStringValue(formData.get("studentName")),
      bookName: getStringValue(formData.get("bookName")),
      homeworkType: getStringValue(formData.get("homeworkType")),
      tutorName: getStringValue(formData.get("tutorName")),
    };
    const videoSource = await fileToDataUrl(video);

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
