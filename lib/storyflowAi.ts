import OpenAI from "openai";
import type { StoryflowAnalysis, StoryflowPageAnalysis } from "@/lib/storyflowStore";

const getAiClient = () => {
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  if (!apiKey) {
    throw new Error("LLM_API_KEY is not configured on server");
  }

  if (!baseURL) {
    throw new Error("LLM_BASE_URL is not configured on server");
  }

  return new OpenAI({
    apiKey,
    baseURL,
  });
};

const getModel = () => process.env.LLM_MODEL || "gemini-3-pro-preview";

const extractTextFromContentPart = (part: unknown): string => {
  if (!part || typeof part !== "object") return "";

  const candidate = part as {
    text?: unknown;
    value?: unknown;
    content?: unknown;
  };

  if (typeof candidate.text === "string") return candidate.text;
  if (typeof candidate.value === "string") return candidate.value;
  if (typeof candidate.content === "string") return candidate.content;
  return "";
};

const extractChatCompletionText = (
  response: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>
) => {
  if (!("choices" in response) || !Array.isArray(response.choices)) {
    return "";
  }

  const content = response.choices[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const contentParts = content as unknown[];

  return contentParts
    .map(extractTextFromContentPart)
    .filter((value) => value.trim().length > 0)
    .join("\n")
    .trim();
};

const extractJson = (rawText: string) => {
  const cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
};

const escapeControlCharsInJsonStrings = (input: string) => {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      if (char === "\t") {
        output += "\\t";
        continue;
      }
    }

    output += char;
  }

  return output;
};

const removeTrailingCommas = (input: string) =>
  input.replace(/,\s*([}\]])/g, "$1");

const ensureStringArray = (value: unknown, fallback: string[] = []) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : fallback;

const ensurePageArray = (value: unknown): StoryflowPageAnalysis[] => {
  if (!Array.isArray(value)) return [];

  return value.map((item, index) => {
    const page = item as Partial<StoryflowPageAnalysis>;
    return {
      pageIndex:
        typeof page.pageIndex === "number" ? page.pageIndex : index,
      pageTitle:
        typeof page.pageTitle === "string" && page.pageTitle.trim()
          ? page.pageTitle.trim()
          : `第 ${index + 1} 页`,
      storyBeat:
        typeof page.storyBeat === "string" ? page.storyBeat.trim() : "",
      visibleText:
        typeof page.visibleText === "string" ? page.visibleText.trim() : "",
      clozeHint:
        typeof page.clozeHint === "string" ? page.clozeHint.trim() : "",
      bilingualHint:
        typeof page.bilingualHint === "string" ? page.bilingualHint.trim() : "",
      speakingPrompt: ensureStringArray(page.speakingPrompt, []),
      keyVocabulary: ensureStringArray(page.keyVocabulary, []),
    };
  });
};

const normalizeAnalysis = (value: unknown): StoryflowAnalysis => {
  const analysis = (value || {}) as Partial<StoryflowAnalysis>;

  return {
    title:
      typeof analysis.title === "string" && analysis.title.trim()
        ? analysis.title.trim()
        : "未命名故事",
    summary:
      typeof analysis.summary === "string" ? analysis.summary.trim() : "",
    fullText:
      typeof analysis.fullText === "string" ? analysis.fullText.trim() : "",
    characters: ensureStringArray(analysis.characters, []),
    setting: {
      time:
        typeof analysis.setting?.time === "string"
          ? analysis.setting.time.trim()
          : "",
      place:
        typeof analysis.setting?.place === "string"
          ? analysis.setting.place.trim()
          : "",
    },
    mindMap: {
      beginning: ensureStringArray(analysis.mindMap?.beginning, []),
      middle: ensureStringArray(analysis.mindMap?.middle, []),
      end: ensureStringArray(analysis.mindMap?.end, []),
    },
    pages: ensurePageArray(analysis.pages),
    shadowPageTexts: ensureStringArray((analysis as { shadowPageTexts?: unknown }).shadowPageTexts, []),
    keywords: ensureStringArray(analysis.keywords, []),
    teacherGuide: ensureStringArray(analysis.teacherGuide, []),
  };
};

const parseAnalysis = (rawText: string) => {
  const extracted = extractJson(rawText);

  try {
    return normalizeAnalysis(JSON.parse(extracted));
  } catch {
    const repaired = removeTrailingCommas(
      escapeControlCharsInJsonStrings(extracted)
    );
    return normalizeAnalysis(JSON.parse(repaired));
  }
};

const containsCjk = (value: string) => /[\u4e00-\u9fff]/.test(value);

const needsEnglishMindMap = (analysis: StoryflowAnalysis) => {
  const { beginning, middle, end } = analysis.mindMap;
  return [...beginning, ...middle, ...end].some((item) => containsCjk(item));
};

const normalizeMindMapLines = (analysis: StoryflowAnalysis) => {
  const takeOne = (items: string[]) => {
    const first = items.find((item) => item.trim().length > 0);
    return first ? [first.trim()] : [""];
  };

  return {
    ...analysis,
    mindMap: {
      beginning: takeOne(analysis.mindMap.beginning),
      middle: takeOne(analysis.mindMap.middle),
      end: takeOne(analysis.mindMap.end),
    },
  };
};

const normalizeOcrText = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s([,.;:!?])/g, "$1")
    .trim();

export const ocrStoryPageTexts = async (images: string[]): Promise<string[]> => {
  if (!images.length) return [];

  const ai = getAiClient();
  const defaultModel = getModel();
  const customOcrModel = process.env.STORYFLOW_OCR_MODEL?.trim() || "";
  const fallbackOcrModel = process.env.STORYFLOW_OCR_FALLBACK_MODEL?.trim() || "";
  const models = [customOcrModel, defaultModel, fallbackOcrModel].filter(
    (item, index, arr): item is string => Boolean(item) && arr.indexOf(item) === index
  );
  const configuredChunk = Number(process.env.STORYFLOW_OCR_CHUNK_SIZE || 1);
  const CHUNK_SIZE =
    Number.isFinite(configuredChunk) && configuredChunk > 0
      ? Math.min(4, Math.floor(configuredChunk))
      : 1;
  const outputs = Array(images.length).fill("");

  for (let start = 0; start < images.length; start += CHUNK_SIZE) {
    const chunk = images.slice(start, start + CHUNK_SIZE);
    const prompt = `
You are doing OCR for children's English picture-book pages.

Rules:
1) Return ONLY JSON.
2) Keep page order exactly as input.
3) "pageTexts" length must equal ${chunk.length}.
4) Extract the visible English text on each page as faithfully as possible.
5) If a page has no readable text, return an empty string for that page.
6) Keep punctuation; merge line breaks into spaces.

JSON:
{
  "pageTexts": ["", ""]
}
`;

    let rawText = "";
    for (const model of models) {
      const create = async (withResponseFormat: boolean) =>
        ai.chat.completions.create({
          model,
          temperature: 0,
          ...(withResponseFormat ? { response_format: { type: "json_object" } } : {}),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                ...chunk.flatMap((url, index) => [
                  { type: "text" as const, text: `Page ${start + index + 1}` },
                  { type: "image_url" as const, image_url: { url } },
                ]),
              ] as never,
            },
          ],
        } as never);

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await create(true);
        rawText = extractChatCompletionText(response);
      } catch {
        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await create(false);
          rawText = extractChatCompletionText(response);
        } catch {
          rawText = "";
        }
      }
      if (rawText) break;
    }

    if (!rawText) continue;

    let parsed: { pageTexts?: unknown } = {};
    try {
      parsed = JSON.parse(extractJson(rawText)) as { pageTexts?: unknown };
    } catch {
      try {
        parsed = JSON.parse(
          removeTrailingCommas(escapeControlCharsInJsonStrings(extractJson(rawText)))
        ) as { pageTexts?: unknown };
      } catch {
        continue;
      }
    }

    const rawPageTexts = Array.isArray(parsed.pageTexts) ? parsed.pageTexts : [];
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const value = rawPageTexts[offset];
      outputs[start + offset] = typeof value === "string" ? normalizeOcrText(value) : "";
    }
  }

  return outputs;
};

const rewriteMindMapToEnglish = async (
  ai: OpenAI,
  model: string,
  payload: {
    title: string;
    summary: string;
    mindMap: StoryflowAnalysis["mindMap"];
  }
) => {
  const prompt = `
You are an expert children's English teacher.

Rewrite the story mind map into SIMPLE ENGLISH for kids.

Rules:
1) Return ONLY JSON (no markdown, no extra text).
2) Each field must be EXACTLY ONE short sentence/phrase.
3) 4-10 English words each.
4) No Chinese characters at all.

Input:
Title: ${payload.title}
Summary (Chinese): ${payload.summary}
Original mind map (may contain Chinese):
${JSON.stringify(payload.mindMap)}

Output JSON format:
{
  "mindMap": {
    "beginning": [""],
    "middle": [""],
    "end": [""]
  }
}
`;

  const create = async (withResponseFormat: boolean) =>
    ai.chat.completions.create({
      model,
      temperature: 0.2,
      ...(withResponseFormat ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content: prompt }],
    } as never);

  let response: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>;
  try {
    response = await create(true);
  } catch {
    response = await create(false);
  }

  const responseText = extractChatCompletionText(response);
  const extracted = extractJson(responseText);
  const parsed = JSON.parse(
    removeTrailingCommas(escapeControlCharsInJsonStrings(extracted))
  ) as { mindMap?: StoryflowAnalysis["mindMap"] };

  const mindMap = parsed.mindMap;
  if (!mindMap) {
    throw new Error("invalid mindMap");
  }

  const ensureOne = (items: unknown) =>
    Array.isArray(items)
      ? items
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 1)
      : [""];

  const next = {
    beginning: ensureOne(mindMap.beginning),
    middle: ensureOne(mindMap.middle),
    end: ensureOne(mindMap.end),
  };

  const combined = [...next.beginning, ...next.middle, ...next.end].join(" ");
  if (containsCjk(combined)) {
    throw new Error("mindMap still contains CJK");
  }

  return next;
};

export const analyzeStoryImages = async (
  images: string[],
  sourceName?: string,
  previewImages?: string[]
): Promise<StoryflowAnalysis> => {
  if (!images.length) {
    throw new Error("至少需要一张图片才能分析");
  }

  const ai = getAiClient();
  const model = getModel();

  const safePreviewImages =
    previewImages && previewImages.length
      ? previewImages.slice(0, 6)
      : images.slice(0, 6);

  const CHUNK_SIZE = 10;

  const chunkImages = <T,>(all: T[], size: number) => {
    const chunks: T[][] = [];
    for (let index = 0; index < all.length; index += size) {
      chunks.push(all.slice(index, index + size));
    }
    return chunks;
  };

  const extractJsonLoose = (rawText: string) => {
    const extracted = extractJson(rawText);
    try {
      return JSON.parse(extracted) as unknown;
    } catch {
      return JSON.parse(
        removeTrailingCommas(escapeControlCharsInJsonStrings(extracted))
      ) as unknown;
    }
  };

  const detectCoverTitle = async (coverUrl: string) => {
    const prompt = `
Extract the picture book title from the cover image.

Rules:
1) Return ONLY JSON.
2) Title must be English, 2-8 words.
3) If you cannot read a title, return an empty string.

JSON:
{ "title": "" }
`;

    const response = await ai.chat.completions.create({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: coverUrl } },
          ] as never,
        },
      ],
    } as never);

    const text = extractChatCompletionText(response);
    const parsed = (extractJsonLoose(text) || {}) as { title?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";

    if (!title) return "";
    if (containsCjk(title)) return "";
    return title;
  };

  const analyzeChunk = async (
    chunk: string[],
    chunkIndex: number,
    total: number,
    chunkStartPageIndex: number
  ) => {
    const prompt = `
你将看到一本绘本的部分页面（第 ${chunkIndex + 1}/${total} 组）。
你必须严格逐页读取“页面上的英文原文”，不要改写、不要补写、不要总结替代原文。

【硬性规则】
1) 只返回 JSON。
2) pageTexts 必须与图片顺序完全一致，长度必须等于本组图片数量。
3) pageTexts 每一项都要尽可能按页面原文提取；保留标点；多行可合并为空格。
4) 读不到文本时返回空字符串 ""，不要猜测。
5) events 仅用于剧情汇总，必须是英文短句（4-10词）。
6) summaryZh 仅 1-2 句中文。

【输出 JSON 格式】
{
  "events": ["", "", ""],
  "pageTexts": ["", "", ""],
  "characters": ["", ""],
  "setting": { "time": "", "place": "" },
  "summaryZh": ""
}
`;

    const response = await ai.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...chunk.flatMap((url, index) => [
              {
                type: "text" as const,
                text: `Page ${chunkStartPageIndex + index + 1}:`,
              },
              { type: "image_url" as const, image_url: { url } },
            ]),
          ] as never,
        },
      ],
    } as never);

    const text = extractChatCompletionText(response);
    const parsed = (extractJsonLoose(text) || {}) as {
      events?: unknown;
      pageTexts?: unknown;
      characters?: unknown;
      setting?: unknown;
      summaryZh?: unknown;
    };

    const events = ensureStringArray(parsed.events, []).slice(0, 6);
    const rawPageTexts = ensureStringArray(parsed.pageTexts, []);
    const pageTexts = Array.from({ length: chunk.length }, (_, idx) => {
      const text = rawPageTexts[idx];
      return typeof text === "string" ? text.trim() : "";
    });
    const characters = ensureStringArray(parsed.characters, []).slice(0, 8);
    const setting = parsed.setting as { time?: unknown; place?: unknown } | undefined;
    const summaryZh = typeof parsed.summaryZh === "string" ? parsed.summaryZh.trim() : "";

    return {
      chunkStartPageIndex,
      events,
      pageTexts,
      characters,
      setting: {
        time: typeof setting?.time === "string" ? setting.time.trim() : "",
        place: typeof setting?.place === "string" ? setting.place.trim() : "",
      },
      summaryZh,
    };
  };

  const buildOutlineFromChunks = async (
    chunks: Array<Awaited<ReturnType<typeof analyzeChunk>>>,
    coverTitle: string
  ) => {
    const mergedEvents = chunks.flatMap((item) => item.events).filter(Boolean);
    const mergedChars = Array.from(
      new Set(chunks.flatMap((item) => item.characters).filter(Boolean))
    ).slice(0, 8);
    const mergedSummaryZh = chunks
      .map((item) => item.summaryZh)
      .filter(Boolean)
      .join("\n");

    const lastSetting = chunks
      .map((item) => item.setting)
      .reverse()
      .find((item) => item.time || item.place) || { time: "", place: "" };

    const prompt = `
你是儿童英文绘本老师。现在给你“整本书按组提取的要点”，请你生成全书级别的总结和思维导图。

要求：
1) mindMap 只包含 3 行：Beginning / Middle / Ending，各 1 句英文短句（4-10 个词）。
2) mindMap 必须总结全书，不是前几页。Ending 必须反映故事最终结果。
3) summary 用中文，1-3 句，概括全书。
4) characters / keywords 用英文。
5) title 用英文；优先使用 coverTitle；如果 coverTitle 为空，使用 sourceName。
6) 只返回 JSON。

输入：
- coverTitle: ${coverTitle || ""}
- sourceName: ${sourceName || "Untitled"}
- mergedEvents (English):
${mergedEvents.map((e, i) => `${i + 1}. ${e}`).join("\n")}

- mergedSummaryZh (Chinese):
${mergedSummaryZh}

输出 JSON：
{
  "title": "",
  "summary": "",
  "characters": [""],
  "setting": { "time": "", "place": "" },
  "mindMap": { "beginning": [""], "middle": [""], "end": [""] },
  "keywords": [""]
}
`;

    const response = await ai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    } as never);

    const text = extractChatCompletionText(response);
    const parsed = (extractJsonLoose(text) || {}) as Partial<StoryflowAnalysis>;

    const outline = normalizeAnalysis(parsed);
    const withSetting = {
      ...outline,
      characters: outline.characters.length ? outline.characters : mergedChars,
      setting: {
        time: outline.setting.time || lastSetting.time,
        place: outline.setting.place || lastSetting.place,
      },
    };

    return normalizeMindMapLines(withSetting);
  };

  const buildPreviewPagesFromText = (pageTexts: string[], count: number): StoryflowPageAnalysis[] =>
    Array.from({ length: count }, (_, index) => {
      const visibleText = (pageTexts[index] || "").trim();
      const normalized = visibleText.replace(/\s+/g, " ").trim();
      const rawTokens = normalized
        .split(/[^A-Za-z']+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1);
      const uniqueVocabulary = Array.from(new Set(rawTokens)).slice(0, 6);

      return {
        pageIndex: index,
        pageTitle: normalized ? `Page ${index + 1}` : `第 ${index + 1} 页`,
        storyBeat: normalized,
        visibleText: normalized,
        clozeHint: "",
        bilingualHint: "先观察画面，再根据原文完整复述。",
        speakingPrompt: [
          "画面中有谁？",
          "他们在做什么？",
          "用英文复述这一页的句子。",
        ],
        keyVocabulary: uniqueVocabulary,
      };
    });

  const coverTitle = await detectCoverTitle(images[0]);
  const imageChunks = chunkImages(images, CHUNK_SIZE);
  const chunkResults: Array<Awaited<ReturnType<typeof analyzeChunk>>> = [];

  for (let index = 0; index < imageChunks.length; index += 1) {
    const chunkStartPageIndex = index * CHUNK_SIZE;
    // eslint-disable-next-line no-await-in-loop
    const chunkResult = await analyzeChunk(
      imageChunks[index],
      index,
      imageChunks.length,
      chunkStartPageIndex
    );
    chunkResults.push(chunkResult);
  }

  const outline = await buildOutlineFromChunks(chunkResults, coverTitle);
  const outlineWithFallbackTitle =
    outline.title && outline.title !== "未命名故事"
      ? outline
      : {
          ...outline,
          title:
            coverTitle ||
            (sourceName || "Untitled Story").trim() ||
            "Untitled Story",
        };
  const shadowPageTexts = Array(images.length).fill("");
  chunkResults.forEach((chunk) => {
    chunk.pageTexts.forEach((text, idx) => {
      const targetIndex = chunk.chunkStartPageIndex + idx;
      if (targetIndex < shadowPageTexts.length) {
        shadowPageTexts[targetIndex] = text;
      }
    });
  });
  if (shadowPageTexts.length > 0) {
    shadowPageTexts[0] =
      coverTitle ||
      outlineWithFallbackTitle.title ||
      shadowPageTexts[0] ||
      "";
  }
  const previewPages = buildPreviewPagesFromText(
    shadowPageTexts,
    Math.min(safePreviewImages.length, shadowPageTexts.length || safePreviewImages.length)
  );

  let combined: StoryflowAnalysis = {
    ...outlineWithFallbackTitle,
    fullText: "",
    pages: previewPages,
    shadowPageTexts,
    teacherGuide: [],
  };

  if (needsEnglishMindMap(combined)) {
    try {
      const mindMap = await rewriteMindMapToEnglish(ai, model, {
        title: combined.title,
        summary: combined.summary,
        mindMap: combined.mindMap,
      });
      combined = normalizeMindMapLines({ ...combined, mindMap });
    } catch {
      // ignore
    }
  }

  return combined;
};
