import { NextResponse } from "next/server";
import { createSignedDownloadUrl } from "@/lib/cos";
import { analyzeStoryImages, ocrStoryPageTexts } from "@/lib/storyflowAi";
import type { StoryflowAnalysis, StoryflowPageAnalysis } from "@/lib/storyflowStore";

export const runtime = "nodejs";

type StoryflowAnalyzeRequest = {
  images?: unknown;
  pageObjectKeys?: unknown;
  previewPageObjectKeys?: unknown;
  sourceName?: unknown;
  providedShadowPageTexts?: unknown;
};

const MAX_FULL_ANALYZE_IMAGES = 8;

const getString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ocr_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const normalizeText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();

const downloadUrlAsDataImage = async (url: string) => {
  const response = await fetch(url, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`download_image_failed:${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
};

const resolveAiInputImages = async (urls: string[]) =>
  Promise.all(
    urls.map(async (url) => {
      try {
        return await downloadUrlAsDataImage(url);
      } catch (error) {
        console.warn("Storyflow image download fallback to remote url:", error);
        return url;
      }
    })
  );

const takeWords = (value: string, count: number) =>
  normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .slice(0, count)
    .join(" ");

const firstNonEmpty = (items: string[]) => items.find((item) => item.trim().length > 0) || "";

const pickFirstMeaningfulLine = (value: string) => {
  const clean = normalizeText(value);
  if (!clean) return "";
  const chunks = clean
    .split(/[.!?]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return chunks[0] || clean;
};

const extractCoverTitle = (coverText: string, fallbackTitle: string) => {
  const clean = normalizeText(coverText);
  if (!clean) return fallbackTitle.trim();

  const stopWords = new Set([
    "oxford",
    "reading",
    "tree",
    "stage",
    "series",
    "created",
    "by",
    "roderick",
    "hunt",
    "alex",
    "brychta",
    "author",
    "illustrator",
  ]);
  const tokens = clean.split(" ").filter(Boolean);
  const articleIndex = tokens.findIndex((token) => {
    const lower = token.toLowerCase();
    return lower === "the" || lower === "a" || lower === "an";
  });

  if (articleIndex >= 0) {
    const picked: string[] = [];
    for (let index = articleIndex; index < tokens.length; index += 1) {
      const token = tokens[index];
      const normalized = token.toLowerCase().replace(/[^a-z']/g, "");
      if (!normalized) continue;
      if (picked.length > 0 && stopWords.has(normalized)) {
        break;
      }
      picked.push(token);
      if (picked.length >= 8) break;
    }
    const candidate = normalizeText(picked.join(" "));
    if (candidate.split(" ").length >= 2) {
      return candidate;
    }
  }

  const firstLine = pickFirstMeaningfulLine(clean);
  const firstLineWords = firstLine.split(" ").filter(Boolean).slice(0, 8);
  const candidate = normalizeText(firstLineWords.join(" "));
  if (candidate) return candidate;
  return fallbackTitle.trim();
};

const enforceCoverAsTitle = (
  pageTexts: string[],
  fallbackTitle: string
) => {
  if (!pageTexts.length) return pageTexts;
  const coverTitle = extractCoverTitle(pageTexts[0] || "", fallbackTitle);
  if (!coverTitle) return pageTexts;

  const next = [...pageTexts];
  next[0] = coverTitle;
  return next;
};

const extractKeywords = (pageTexts: string[]) => {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "at", "is", "are", "was", "were",
    "it", "he", "she", "they", "we", "you", "i", "this", "that", "for", "with", "as", "be",
    "from", "by", "his", "her", "their", "our", "my", "your", "had", "has", "have", "do", "did",
    "not", "no", "yes",
  ]);

  const frequency = new Map<string, number>();
  pageTexts
    .join(" ")
    .toLowerCase()
    .split(/[^a-z']+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stopWords.has(token))
    .forEach((token) => {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    });

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
};

const inferSetting = (pageTexts: string[]) => {
  const text = pageTexts.join(" ").toLowerCase();

  const timeRules: Array<{ keywords: string[]; value: string }> = [
    { keywords: ["morning", "sunrise", "breakfast"], value: "Morning" },
    { keywords: ["afternoon", "lunch", "sunny day", "daytime"], value: "Daytime" },
    { keywords: ["evening", "sunset"], value: "Evening" },
    { keywords: ["night", "moon", "bedtime", "dark"], value: "Night" },
    { keywords: ["today", "school day"], value: "School day" },
  ];

  const placeRules: Array<{ keywords: string[]; value: string }> = [
    { keywords: ["beach", "sand", "sea", "tide"], value: "Beach" },
    { keywords: ["school", "classroom", "teacher"], value: "School" },
    { keywords: ["park", "playground"], value: "Park" },
    { keywords: ["home", "house", "kitchen", "bedroom"], value: "Home" },
    { keywords: ["shop", "store"], value: "Shop" },
    { keywords: ["building site", "crane", "worker"], value: "Building site" },
  ];

  const hit = (keywords: string[]) => keywords.some((item) => text.includes(item));
  return {
    time: timeRules.find((rule) => hit(rule.keywords))?.value || "",
    place: placeRules.find((rule) => hit(rule.keywords))?.value || "",
  };
};

const extractCharacters = (pageTexts: string[]) => {
  const blacklist = new Set([
    "The", "A", "An", "And", "But", "Then", "When", "Where", "What", "Who", "Why", "How",
    "I", "We", "You", "He", "She", "They", "It",
  ]);
  const found = new Map<string, number>();
  const text = pageTexts.join(" ");
  const matches = text.match(/\b[A-Z][a-z]+\b/g) || [];
  matches.forEach((name) => {
    if (blacklist.has(name)) return;
    found.set(name, (found.get(name) || 0) + 1);
  });

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);
};

const buildPages = (
  pageTexts: string[],
  previewCount: number
): StoryflowPageAnalysis[] => {
  const count = Math.max(0, Math.min(previewCount, pageTexts.length));
  return Array.from({ length: count }, (_, index) => {
    const visibleText = normalizeText(pageTexts[index] || "");
    const words = visibleText
      .split(/[^A-Za-z']+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 1);
    const keyVocabulary = Array.from(new Set(words.map((item) => item.toLowerCase()))).slice(0, 6);

    return {
      pageIndex: index,
      pageTitle: `Page ${index + 1}`,
      storyBeat: visibleText,
      visibleText,
      bilingualHint: "请先观察图片，再根据原文复述。",
      speakingPrompt: [
        "Who is in this page?",
        "What happened here?",
        "Retell this page in English.",
      ],
      keyVocabulary,
    };
  });
};

const buildRuleBasedAnalysis = (
  sourceName: string,
  pageTexts: string[],
  previewCount: number
): StoryflowAnalysis => {
  const cleaned = pageTexts.map((item) => normalizeText(item));
  const nonEmpty = cleaned.filter(Boolean);
  const first = firstNonEmpty(nonEmpty);
  const middle = nonEmpty[Math.floor(nonEmpty.length / 2)] || first;
  const end = nonEmpty[nonEmpty.length - 1] || middle || first;
  const quarter = nonEmpty[Math.floor(nonEmpty.length * 0.25)] || first;
  const thirdQuarter = nonEmpty[Math.floor(nonEmpty.length * 0.75)] || middle;
  const titleCandidate = pickFirstMeaningfulLine(first);
  const title = sourceName || takeWords(titleCandidate, 10) || "Untitled Story";
  const inferredSetting = inferSetting(cleaned);
  const safeKeywords = extractKeywords(cleaned);

  return {
    title,
    summary: [first, quarter, middle, thirdQuarter, end]
      .filter(Boolean)
      .map((item) => takeWords(item, 18))
      .join(" "),
    fullText: cleaned.filter(Boolean).join("\n"),
    characters: extractCharacters(cleaned),
    setting: inferredSetting,
    mindMap: {
      beginning: [
        takeWords(first || title, 12) || "Story opens.",
        takeWords(quarter || first || title, 12) || "Characters start action.",
      ],
      middle: [
        takeWords(middle || first || title, 12) || "Story develops.",
        takeWords(thirdQuarter || middle || first || title, 12) || "Problem changes.",
      ],
      end: [takeWords(end || middle || first || title, 12) || "Story ends."],
    },
    pages: buildPages(cleaned, previewCount),
    shadowPageTexts: cleaned,
    keywords: safeKeywords,
    teacherGuide: [],
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StoryflowAnalyzeRequest;

    const imagesFromBody = Array.isArray(body.images)
      ? body.images.filter(
          (item): item is string =>
            typeof item === "string" && item.startsWith("data:image/")
        )
      : [];
    const pageObjectKeys = Array.isArray(body.pageObjectKeys)
      ? body.pageObjectKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    const previewPageObjectKeys = Array.isArray(body.previewPageObjectKeys)
      ? body.previewPageObjectKeys.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    const providedShadowPageTexts = Array.isArray(body.providedShadowPageTexts)
      ? body.providedShadowPageTexts.map((item) =>
          typeof item === "string" ? normalizeText(item) : ""
        )
      : [];

    const pageImageUrls =
      imagesFromBody.length > 0
        ? []
        : pageObjectKeys.map((key) => createSignedDownloadUrl(key));
    const previewImageUrls =
      imagesFromBody.length > 0
        ? []
        : (previewPageObjectKeys.length ? previewPageObjectKeys : pageObjectKeys).map(
            (key) => createSignedDownloadUrl(key)
          );

    const images =
      imagesFromBody.length > 0
        ? imagesFromBody
        : await resolveAiInputImages(pageImageUrls);
    const previewImages =
      imagesFromBody.length > 0
        ? imagesFromBody.slice(0, 6)
        : await resolveAiInputImages(previewImageUrls);

    if (!images.length && !providedShadowPageTexts.length) {
      return NextResponse.json(
        { error: "至少需要上传一张图片或页面对象" },
        { status: 400 }
      );
    }

    const sourceName = getString(body.sourceName);
    const totalPages = Math.max(images.length, pageObjectKeys.length, providedShadowPageTexts.length);
    const normalizedTexts = Array.from({ length: totalPages }, (_, index) =>
      providedShadowPageTexts[index] || ""
    );

    if (images.length) {
      try {
        const missingTextIndexes = normalizedTexts
          .map((text, index) => ({ text: text.trim(), index }))
          .filter((item) => !item.text)
          .map((item) => item.index);
        const ocrInputs =
          missingTextIndexes.length > 0
            ? missingTextIndexes
                .map((pageIndex) => images[pageIndex])
                .filter((item): item is string => typeof item === "string" && item.length > 0)
            : [];
        const ocrResults = await withTimeout(
          ocrInputs.length ? ocrStoryPageTexts(ocrInputs) : Promise.resolve([]),
          Number(process.env.STORYFLOW_OCR_TIMEOUT_MS || 240000)
        );
        missingTextIndexes.forEach((pageIndex, resultIndex) => {
          const ocrValue = ocrResults[resultIndex];
          if (typeof ocrValue === "string" && ocrValue.trim()) {
            normalizedTexts[pageIndex] = ocrValue.trim();
          }
        });
      } catch (ocrError) {
        console.warn("Storyflow OCR fallback failed:", ocrError);
      }
    }

    const seededCoverTitle = sourceName || "";
    const normalizedTextsWithCover = enforceCoverAsTitle(normalizedTexts, seededCoverTitle);

    const previewCount = previewImages.length || Math.min(6, totalPages);
    let mergedTexts = [...normalizedTextsWithCover];
    let fallbackResult = buildRuleBasedAnalysis(
      sourceName,
      mergedTexts,
      previewCount
    );
    let aiResult: StoryflowAnalysis | null = null;
    if (images.length) {
      try {
        const analyzeInputs =
          images.length > MAX_FULL_ANALYZE_IMAGES
            ? previewImages.length
              ? previewImages
              : images.slice(0, MAX_FULL_ANALYZE_IMAGES)
            : images;
        aiResult = await withTimeout(
          analyzeStoryImages(analyzeInputs, sourceName, previewImages),
          Number(process.env.STORYFLOW_ANALYZE_TIMEOUT_MS || 300000)
        );
      } catch (aiError) {
        console.warn("Storyflow full analysis fallback to rule-based:", aiError);
      }
    }

    if (aiResult?.shadowPageTexts?.length) {
      const mergedLength = Math.max(mergedTexts.length, aiResult.shadowPageTexts.length);
      mergedTexts = Array.from({ length: mergedLength }, (_, index) => {
        const current = normalizeText(mergedTexts[index] || "");
        if (current) return current;
        const analyzed = normalizeText(aiResult?.shadowPageTexts?.[index] || "");
        return analyzed;
      });
      fallbackResult = buildRuleBasedAnalysis(
        sourceName,
        mergedTexts,
        previewCount
      );
    }

    const finalCoverTitle =
      aiResult?.title?.trim() ||
      fallbackResult.title ||
      sourceName ||
      "";
    mergedTexts = enforceCoverAsTitle(mergedTexts, finalCoverTitle);
    fallbackResult = buildRuleBasedAnalysis(sourceName, mergedTexts, previewCount);

    const mergedSetting = {
      time:
        aiResult?.setting?.time?.trim() ||
        fallbackResult.setting.time ||
        inferSetting(mergedTexts).time,
      place:
        aiResult?.setting?.place?.trim() ||
        fallbackResult.setting.place ||
        inferSetting(mergedTexts).place,
    };
    const mergedKeywords =
      aiResult?.keywords?.length ? aiResult.keywords : fallbackResult.keywords;
    const mergedMindMap = aiResult?.mindMap
      ? {
          beginning: (() => {
            const items = aiResult.mindMap.beginning.filter((item) => item.trim());
            return items.length ? items : fallbackResult.mindMap.beginning;
          })(),
          middle: (() => {
            const items = aiResult.mindMap.middle.filter((item) => item.trim());
            return items.length ? items : fallbackResult.mindMap.middle;
          })(),
          end: (() => {
            const items = aiResult.mindMap.end.filter((item) => item.trim());
            return items.length ? items : fallbackResult.mindMap.end;
          })(),
        }
      : fallbackResult.mindMap;

    const result: StoryflowAnalysis = {
      ...(aiResult || fallbackResult),
      title:
        aiResult?.title?.trim() ||
        fallbackResult.title ||
        sourceName ||
        "Untitled Story",
      summary: aiResult?.summary?.trim() || fallbackResult.summary,
      fullText: mergedTexts.filter(Boolean).join("\n"),
      characters:
        aiResult?.characters?.filter((item) => item.trim())?.length
          ? aiResult.characters
          : fallbackResult.characters,
      setting: mergedSetting,
      mindMap: mergedMindMap,
      pages: buildPages(mergedTexts, previewCount),
      shadowPageTexts: mergedTexts,
      keywords: mergedKeywords,
      teacherGuide:
        aiResult?.teacherGuide?.length ? aiResult.teacherGuide : fallbackResult.teacherGuide,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Storyflow analyze route error:", error);
    const message = error instanceof Error ? error.message : "绘本分析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
