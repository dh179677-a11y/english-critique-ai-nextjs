import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeStoryflowVoiceSubtitles,
  type StoryflowSpeakingPracticeRecord,
} from "@/lib/storyflowStore";
import type { AnalysisResult } from "@/types";

export const runtime = "nodejs";

type SpeakingScoreRequest = {
  studentName?: string;
  bookName?: string;
  tutorName?: string;
  storySummary?: string;
  fullText?: string;
  keywords?: string[];
  characters?: string[];
  pageTexts?: Array<{
    pageIndex?: number;
    text?: string;
  }>;
  coachHistory?: Array<{
    role?: "student" | "coach";
    text?: string;
  }>;
  practiceRecord?: StoryflowSpeakingPracticeRecord;
};

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured on server`);
  }
  return value;
};

const getEnv = (name: string) => process.env[name]?.trim() || "";

const getAiClient = () =>
  new OpenAI({
    apiKey: getRequiredEnv("LLM_API_KEY"),
    baseURL: getRequiredEnv("LLM_BASE_URL"),
  });

const getModel = () => process.env.LLM_MODEL?.trim() || "gemini-3-pro-preview";

const getDoubaoEndpoint = () => {
  const baseUrl =
    getEnv("DOUBAO_TEXT_IMAGE_BASE_URL") ||
    getEnv("DOUBAO_CHAT_BASE_URL") ||
    getEnv("DOUBAO_BASE_URL") ||
    "https://ark.cn-beijing.volces.com/api/v3";
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
};

const getDoubaoApiKey = () => getEnv("DOUBAO_TEXT_IMAGE_API_KEY") || getEnv("DOUBAO_API_KEY");

const getDoubaoModel = () =>
  getEnv("DOUBAO_TEXT_IMAGE_MODEL") ||
  getEnv("DOUBAO_MODEL") ||
  "doubao-1-5-lite-32k-250115";

const trimText = (value: unknown, maxLength = 1200) => {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const normalizeStringArray = (value: unknown, limit = 8) =>
  Array.isArray(value)
    ? value.map((item) => trimText(item, 80)).filter(Boolean).slice(0, limit)
    : [];

const normalizePracticeRecord = (
  value: SpeakingScoreRequest["practiceRecord"]
): StoryflowSpeakingPracticeRecord => ({
  id: trimText(value?.id, 80) || `speaking_${Date.now()}`,
  createdAt: typeof value?.createdAt === "number" ? value.createdAt : Date.now(),
  durationSec: Math.max(1, Number(value?.durationSec || 1)),
  promptRevealCount: Math.max(0, Number(value?.promptRevealCount || 0)),
  originalRevealCount: Math.max(0, Number(value?.originalRevealCount || 0)),
  totalPages: Math.max(1, Number(value?.totalPages || 1)),
  practicedPages: Math.max(0, Number(value?.practicedPages || 0)),
  score: clampScore(Number(value?.score || 0)),
  ratingLabel: trimText(value?.ratingLabel, 40) || "待评分",
  promptViewedTexts: Array.isArray(value?.promptViewedTexts) ? value.promptViewedTexts : [],
  originalViewedTexts: Array.isArray(value?.originalViewedTexts)
    ? value.originalViewedTexts
    : [],
  voiceSubtitles: normalizeStoryflowVoiceSubtitles(value?.voiceSubtitles),
});

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

const extractChatCompletionText = (response: unknown) => {
  const candidate = response as {
    choices?: Array<{
      message?: {
        content?: string | Array<unknown>;
      };
    }>;
  };
  const content = candidate.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(extractTextFromContentPart).filter(Boolean).join("\n").trim();
};

const removeTrailingCommas = (input: string) => input.replace(/,\s*([}\]])/g, "$1");

const extractJson = (rawText: string) => {
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

const parseAnalysisResult = (rawText: string): AnalysisResult =>
  JSON.parse(removeTrailingCommas(extractJson(rawText))) as AnalysisResult;

const mergeAnalysisResult = (
  fallbackResult: AnalysisResult,
  result: Partial<AnalysisResult>
): AnalysisResult => ({
  ...fallbackResult,
  ...result,
  studentName: result.studentName || fallbackResult.studentName,
  bookName: result.bookName || fallbackResult.bookName,
  homeworkType: "看图说话",
  tutorName: result.tutorName || fallbackResult.tutorName,
  simpleComment: trimText(result.simpleComment || fallbackResult.simpleComment, 200),
  suggestions:
    Array.isArray(result.suggestions) && result.suggestions.length
      ? result.suggestions.slice(0, 5)
      : fallbackResult.suggestions,
});

const requestScoreCompletion = async (
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string
) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(getEnv("DOUBAO_USE_X_API_KEY") === "true" ? { "X-Api-Key": apiKey } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(
      (parsed as { error?: { message?: string }; message?: string } | null)?.error?.message ||
        (parsed as { message?: string } | null)?.message ||
        raw ||
        "AI score request failed"
    );
  }

  const completionText = parsed ? extractChatCompletionText(parsed) : raw;
  return parseAnalysisResult(completionText);
};

const averagePracticeScore = (record: StoryflowSpeakingPracticeRecord) => {
  const pageCoverage = record.practicedPages / Math.max(1, record.totalPages);
  const promptPenalty = Math.min(22, record.promptRevealCount * 5);
  const originalPenalty = Math.min(34, record.originalRevealCount * 12);
  const paceBonus =
    record.durationSec >= record.practicedPages * 6 &&
    record.durationSec <= record.practicedPages * 55
      ? 8
      : 0;
  return clampScore(60 + pageCoverage * 28 + paceBonus - promptPenalty - originalPenalty);
};

const buildFallbackResult = (
  payload: SpeakingScoreRequest,
  record: StoryflowSpeakingPracticeRecord
): AnalysisResult => {
  const studentName = trimText(payload.studentName, 80) || "同学";
  const bookName = trimText(payload.bookName, 120);
  const baseScore = averagePracticeScore(record);
  const fluency = clampScore(baseScore + (record.originalRevealCount ? -8 : 4));
  const pronunciation = clampScore(baseScore - 2);
  const intonation = clampScore(baseScore - 4);
  const vocabulary = clampScore(baseScore - record.promptRevealCount * 3);
  const emotion = clampScore(baseScore + 3);
  const completionText = `${record.practicedPages}/${record.totalPages} 页`;
  const supportText = `看提示 ${record.promptRevealCount} 次，看原文 ${record.originalRevealCount} 次`;

  return {
    studentName,
    bookName,
    homeworkType: "看图说话",
    tutorName: trimText(payload.tutorName, 80),
    fluency: {
      score: fluency,
      comment:
        record.practicedPages >= record.totalPages
          ? "本次练习覆盖了整本绘本，表达完成度较好。后续可以继续减少停顿，让复述更连贯。"
          : "本次只完成了部分页面，建议下次尽量按顺序完成整本绘本，再做完整复述。",
    },
    pronunciation: {
      score: pronunciation,
      comment: "本次看图说话没有录音细节可逐词分析，建议重点关注原文关键词的清晰发音和句末收尾。",
    },
    intonation: {
      score: intonation,
      comment: "复述时可以更像讲故事一样表达，重点词稍微加重，句子之间保留自然停顿。",
    },
    vocabulary: {
      score: vocabulary,
      comment:
        record.originalRevealCount > 0
          ? "练习中查看了原文，说明有些目标词句还没有完全记牢。建议把这些词句单独复习。"
          : "能在不直接看原文的情况下完成练习，说明对目标词句已有一定记忆基础。",
    },
    emotion: {
      score: emotion,
      comment: "愿意完成看图说话练习是很好的开始。后续可以把声音再放开一点，像给别人讲故事一样表达。",
    },
    overallComment: `${studentName}完成了一次《${bookName || "这本绘本"}》看图说话练习，本次练习覆盖 ${completionText}，用时 ${record.durationSec} 秒，${supportText}。我是根据刚才 AI 语音教练陪练记录和练习数据生成这份点评：本次核心目标是让孩子看图回忆绘本原文，并尽量减少对提示和原文的依赖。\n\n从练习数据看，${record.originalRevealCount > 0 ? "孩子还需要继续巩固原文记忆，尤其是完整句子的顺序和关键词。" : "孩子已经能较好地控制不直接看答案，这是很好的学习习惯。"} 下一次建议先只看图片复述一遍，再只领取一次提示，最后对照原文查漏补缺。`,
    simpleComment: `${studentName}这次完成了 ${completionText} 的看图说话练习。我会根据刚才的陪练情况提醒你：最需要继续练的是减少看提示和看原文的次数。下次先只看图片说一遍，再用提示检查遗漏。`,
    suggestions: [
      "先只看图片完整说一遍，不要一开始就点提示。",
      "把查看过提示或原文的页面单独复习 2 遍。",
      "每页先说主角，再说动作，最后补充原文关键词。",
      "遇到忘记的句子，先说首词或关键词，再尝试补完整句。",
      "练完后把最不熟的 2 页重新只看图片复述。",
    ],
    grammarSummary: "重点关注绘本原文中的主语 + 动作结构、常见过去式表达、人物名称和核心名词。看图说话的目标不是自由发挥，而是尽量用原文句型复述图片内容。",
  };
};

const buildPrompt = (payload: SpeakingScoreRequest, record: StoryflowSpeakingPracticeRecord) => {
  const pageTexts = Array.isArray(payload.pageTexts)
    ? payload.pageTexts
        .map((item) => {
          const pageNo = Number(item.pageIndex || 0) + 1;
          const text = trimText(item.text, 220);
          return text ? `第 ${pageNo} 页：${text}` : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  const coachHistory = Array.isArray(payload.coachHistory)
    ? payload.coachHistory
        .slice(-18)
        .map((item) => `${item.role === "coach" ? "AI语音教练" : "学生"}：${trimText(item.text, 220)}`)
        .filter((item) => item.trim().length > 4)
        .join("\n")
    : "";

  return `
你就是刚才陪学生完成绘本练习的 AI 语音教练，同时也是一位资深儿童英语绘本老师。
请以“刚才和学生一起练习后的课后点评”口吻，生成一份会保存到得分点评里的中文 AI 点评。
你必须优先依据【AI互动记录】判断学生的表现；如果互动记录不足，再结合【练习数据】和【原文页码】做稳妥评价。

【学生】
${trimText(payload.studentName, 80) || "同学"}

【绘本】
${trimText(payload.bookName, 120) || "未命名绘本"}

【故事摘要】
${trimText(payload.storySummary, 600) || "暂无"}

【重点词】
${normalizeStringArray(payload.keywords, 12).join(" / ") || "暂无"}

【角色】
${normalizeStringArray(payload.characters, 10).join(" / ") || "暂无"}

【原文页码】
${pageTexts || trimText(payload.fullText, 1600) || "暂无"}

【练习数据】
用时：${record.durationSec} 秒
练习页数：${record.practicedPages}/${record.totalPages}
查看提示：${record.promptRevealCount} 次
查看原文：${record.originalRevealCount} 次
系统等级：${record.ratingLabel}

【AI互动记录】
${coachHistory || "暂无"}

【输出要求】
只能返回 JSON，不要 Markdown。
所有 comment 和说明必须用中文。
评分范围 0-100，必须是整数。
看图说话的核心目标：孩子看图回忆绘本原文，并尽量用原文句型复述，不是自由编故事。
点评要像同一个 AI 语音教练在课后总结，不要写成冷冰冰的系统报告。
如果 AI互动记录里没有明确听到某个发音错误，不要编造具体音素问题；可以说“建议继续关注关键词发音”。
如果学生在互动中有跑题、需要提示、需要重复、答应翻页但没有继续等情况，可以温和写进建议。

【JSON格式】
{
  "fluency": { "score": 0, "comment": "" },
  "pronunciation": { "score": 0, "comment": "" },
  "intonation": { "score": 0, "comment": "" },
  "vocabulary": { "score": 0, "comment": "" },
  "emotion": { "score": 0, "comment": "" },
  "overallComment": "",
  "simpleComment": "",
  "suggestions": ["", "", "", "", ""],
  "grammarSummary": ""
}

【评分维度】
- fluency：复述是否连贯，是否完成足够页数，是否过度依赖提示
- pronunciation：优先参考 AI互动记录中学生读句子的情况；没有录音细节时不要编造具体音素错误，只给可执行的发音建议
- intonation：讲故事语气、节奏和重点词表达
- vocabulary：是否掌握重点词、是否过度查看原文
- emotion：自信度、主动练习状态

【overallComment】
写 2 段，第一段必须体现“根据刚才我们的练习/互动”，总结表现；第二段给具体下一步练法。

【simpleComment】
不超过 180 字，先鼓励，再指出一个主要问题，再给一个办法。
`;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SpeakingScoreRequest;
    const record = normalizePracticeRecord(payload.practiceRecord);
    const fallbackResult = buildFallbackResult(payload, record);
    const prompt = buildPrompt(payload, record);

    const doubaoApiKey = getDoubaoApiKey();
    if (doubaoApiKey) {
      try {
        const result = await requestScoreCompletion(
          getDoubaoEndpoint(),
          doubaoApiKey,
          getDoubaoModel(),
          prompt
        );
        return NextResponse.json({
          provider: "doubao-coach",
          result: mergeAnalysisResult(fallbackResult, result),
        });
      } catch (doubaoScoreError) {
        console.error("Storyflow score-speaking-practice doubao fallback:", doubaoScoreError);
      }
    }

    try {
      const ai = getAiClient();
      const response = await ai.chat.completions.create({
        model: getModel(),
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      } as never);

      const rawText = extractChatCompletionText(response);
      const result = parseAnalysisResult(rawText);
      return NextResponse.json({
        provider: "llm-fallback",
        result: mergeAnalysisResult(fallbackResult, result),
      });
    } catch (scoreError) {
      console.error("Storyflow score-speaking-practice fallback:", scoreError);
      return NextResponse.json({ result: fallbackResult });
    }
  } catch (error) {
    console.error("Storyflow score-speaking-practice route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "看图说话点评失败" },
      { status: 500 }
    );
  }
}
