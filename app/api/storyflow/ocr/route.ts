import path from "path";
import { NextResponse } from "next/server";
import { createWorker, OEM, PSM } from "tesseract.js";

export const runtime = "nodejs";

type OcrRequest = {
  images?: unknown;
};

const normalizeText = (value: string, maxLength = 1600) => {
  const normalized = value
    .replace(/[^\x20-\x7E\u2018\u2019\u201c\u201d]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength).trim()
    : normalized;
};

const COMMON_ENGLISH_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "about",
  "but",
  "by",
  "children",
  "every",
  "for",
  "from",
  "going",
  "good",
  "had",
  "has",
  "he",
  "her",
  "him",
  "his",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "pool",
  "said",
  "saw",
  "she",
  "some",
  "swimmers",
  "swimming",
  "that",
  "the",
  "they",
  "this",
  "to",
  "told",
  "took",
  "was",
  "we",
  "week",
  "were",
  "with",
  "you",
]);

const isLikelyEnglishSentence = (value: string) => {
  const words = value.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  if (words.length < 3) return false;
  const commonCount = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length;
  const vowelWordCount = words.filter((word) => /[aeiou]/.test(word)).length;
  return commonCount >= 2 && vowelWordCount / words.length >= 0.65;
};

const trimLeadingOcrNoise = (value: string) => {
  const match = value.match(
    /\b(The|A|An|Every|Mrs|Mr|Miss|Biff|Wilma|Mum|Dad|Kipper|Chip|Floppy|They|He|She|It|We|You|This|That|There|Then|One|Two)\b/
  );
  if (!match || typeof match.index !== "number") return value;
  return value.slice(match.index).trim();
};

const cleanOcrText = (value: string) => {
  const text = normalizeText(value);
  if (!text) return "";

  const sentenceMatches =
    text.match(/[A-Z][A-Za-z0-9'"\u2018\u2019\u201c\u201d,;:() -]{8,}?[.!?]/g) || [];
  const usefulSentences = sentenceMatches
    .map((item) => normalizeText(item))
    .filter((item) => (item.match(/[A-Za-z]/g) || []).length >= 8)
    .filter(isLikelyEnglishSentence)
    .slice(0, 8);

  if (usefulSentences.length) {
    return trimLeadingOcrNoise(usefulSentences.join(" "));
  }

  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length >= 4) return trimLeadingOcrNoise(text);
  return "";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OcrRequest;
    const images = Array.isArray(body.images)
      ? body.images.filter(
          (item): item is string =>
            typeof item === "string" && item.startsWith("data:image/")
        )
      : [];

    if (!images.length) {
      return NextResponse.json({ texts: [] });
    }

    const langPath = path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0"
    );
    const workerPath = path.join(
      process.cwd(),
      "node_modules",
      "tesseract.js",
      "src",
      "worker-script",
      "node",
      "index.js"
    );
    const corePath = path.join(
      process.cwd(),
      "node_modules",
      "tesseract.js-core",
      "tesseract-core-simd-lstm.js"
    );
    const worker = await createWorker(
      "eng",
      OEM.LSTM_ONLY,
      {
        workerPath,
        corePath,
        langPath,
        gzip: true,
        cacheMethod: "none",
      }
    );
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    } as Record<string, string | number>);

    try {
      const texts: string[] = [];
      for (const image of images.slice(0, 30)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await worker.recognize(image);
        texts.push(cleanOcrText(result.data.text || ""));
      }
      return NextResponse.json({ texts });
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    console.error("Storyflow OCR route error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OCR 识别失败",
      },
      { status: 500 }
    );
  }
}
