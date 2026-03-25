import OpenAI from "openai";
import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

const ALLOWED_BLOB_HOST_SUFFIXES = [
  "blob.vercel-storage.com",
  "public.blob.vercel-storage.com",
  ".blob.vercel-storage.com",
  ".public.blob.vercel-storage.com",
];

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

const getModel = () => {
  return process.env.LLM_MODEL || "gemini-3.1-pro-preview-cli";
};

const normalizeVideoSource = (videoSource: string): string => {
  if (videoSource.startsWith("data:video/")) {
    return videoSource;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(videoSource);
  } catch {
    throw new Error("video source is invalid");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("video source must use https or data URL");
  }

  const isAllowedHost = ALLOWED_BLOB_HOST_SUFFIXES.some((suffix) =>
    parsedUrl.hostname.endsWith(suffix)
  );

  if (!isAllowedHost) {
    throw new Error("video source host is not allowed");
  }

  return parsedUrl.toString();
};

const extractTextFromContentPart = (part: unknown): string => {
  if (!part || typeof part !== "object") return "";

  const candidate = part as {
    text?: unknown;
    value?: unknown;
    content?: unknown;
  };

  if (typeof candidate.text === "string") {
    return candidate.text;
  }

  if (typeof candidate.value === "string") {
    return candidate.value;
  }

  if (typeof candidate.content === "string") {
    return candidate.content;
  }

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
    .filter((value: string) => value.trim().length > 0)
    .join("\n")
    .trim();
};

const buildVideoContentVariants = (prompt: string, videoUrl: string) => {
  return [
    [
      { type: "text", text: prompt },
      { type: "video_url", video_url: { url: videoUrl } },
    ],
    [
      { type: "text", text: prompt },
      { type: "input_video", video_url: videoUrl },
    ],
    [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: videoUrl } },
    ],
  ] as Array<Array<Record<string, unknown>>>;
};

const createVideoChatCompletion = async (
  ai: OpenAI,
  prompt: string,
  videoUrl: string,
  options?: { responseFormat?: "json_object"; temperature?: number }
) => {
  const videoSource = normalizeVideoSource(videoUrl);
  const variants = buildVideoContentVariants(prompt, videoSource);
  let lastError: unknown;

  for (const content of variants) {
    try {
      return await ai.chat.completions.create({
        model: getModel(),
        temperature: options?.temperature,
        ...(options?.responseFormat
          ? { response_format: { type: options.responseFormat } }
          : {}),
        messages: [
          {
            role: "user",
            content: content as never,
          },
        ],
      } as never);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const extractJson = (rawText: string): string => {
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

const getErrorDebugMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return String(error ?? "Unknown error");
  }

  const record = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    cause?: unknown;
    error?: unknown;
  };

  const parts: string[] = [];

  if (typeof record.name === "string" && record.name) {
    parts.push(`name=${record.name}`);
  }

  if (typeof record.message === "string" && record.message) {
    parts.push(`message=${record.message}`);
  }

  if (typeof record.status === "number") {
    parts.push(`status=${record.status}`);
  }

  if (typeof record.code === "string" && record.code) {
    parts.push(`code=${record.code}`);
  }

  if (record.error && typeof record.error === "object") {
    const nested = record.error as { message?: unknown; code?: unknown };
    if (typeof nested.message === "string" && nested.message) {
      parts.push(`api_message=${nested.message}`);
    }
    if (typeof nested.code === "string" && nested.code) {
      parts.push(`api_code=${nested.code}`);
    }
  }

  if (record.cause && typeof record.cause === "object") {
    const cause = record.cause as {
      code?: unknown;
      errno?: unknown;
      message?: unknown;
    };
    if (typeof cause.code === "string" && cause.code) {
      parts.push(`cause_code=${cause.code}`);
    }
    if (typeof cause.errno === "string" && cause.errno) {
      parts.push(`cause_errno=${cause.errno}`);
    }
    if (typeof cause.message === "string" && cause.message) {
      parts.push(`cause_message=${cause.message}`);
    }
  }

  return parts.join(" | ") || "Unknown error";
};

const normalizeAiErrorMessage = (message: string): string => {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes("not implemented") ||
    lower.includes("not_implemented") ||
    lower.includes("500 not implemented")
  ) {
    return "当前 LLM 中转接口未实现视频分析所需能力，当前这版 chat.completions 视频传参也不被支持。";
  }

  if (
    lower.includes("responses") &&
    (lower.includes("unsupported") || lower.includes("not found"))
  ) {
    return "当前 LLM 中转不支持 Responses API。";
  }

  if (
    lower.includes("input_file") ||
    lower.includes("file_data") ||
    lower.includes("unsupported file")
  ) {
    return "当前 LLM 中转不支持 input_file / file_data 视频文件输入。";
  }

  if (
    lower.includes("video_url") ||
    lower.includes("input_video") ||
    lower.includes("video")
  ) {
    return "当前 LLM 中转不接受这版视频字段格式，说明它的 chat.completions 视频参数与当前实现不兼容。";
  }

  if (
    lower.includes("connection error") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("network")
  ) {
    return "连接上游 LLM 失败。请优先检查 Vercel 线上环境变量里的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，并确认该中转接口允许来自 Vercel 的服务端请求。";
  }

  return normalized;
};

const buildAnalyzePrompt = (metadata: VideoMetadata) => {
  const { studentName, bookName, homeworkType, tutorName } = metadata;

  const nameInstruction = studentName
    ? `学生姓名：${studentName}。请在评价中自然使用这个名字。`
    : `如果没有学生姓名，请使用“同学”称呼。`;

  return `
你是一位有20年经验的儿童英语口语测评专家。

请直接观看我提供的视频，分析其中学生的英文口语表现，并进行专业、细致、可执行的点评。

【基础信息】
${nameInstruction}
绘本名称：${bookName || "未指定"}
作业类型：${homeworkType || "口语练习"}
辅导老师：${tutorName || "Teacher"}

【任务要求】
请根据视频中的英文口语表现，输出以下结构化评分与点评。

【严格要求】
1. 只能返回 JSON
2. 不要返回 markdown
3. 不要加解释文字
4. 不要使用 \`\`\`json
5. 所有 comment 和说明文字必须使用中文
6. 分数范围 0-100，必须是整数

【JSON格式必须严格如下】
{
  "fluency": {
    "score": 0,
    "comment": ""
  },
  "pronunciation": {
    "score": 0,
    "comment": ""
  },
  "intonation": {
    "score": 0,
    "comment": ""
  },
  "vocabulary": {
    "score": 0,
    "comment": ""
  },
  "emotion": {
    "score": 0,
    "comment": ""
  },
  "overallComment": "",
  "suggestions": ["", "", ""],
  "grammarSummary": ""
}

【评分标准】
- fluency：流畅度、停顿、卡顿、自我修正
- pronunciation：发音清晰度、音素准确性
- intonation：语调、重音、节奏自然度
- vocabulary：词汇使用是否恰当、丰富
- emotion：表达状态、自信度、感染力

【overallComment要求】
请按以下结构输出完整中文报告：
1. 作业亮点
2. 发音评测
3. 语法评测
4. 整体评价

【grammarSummary要求】
用中文总结1-2个最值得家长辅导的语法点。

现在开始分析，并严格只返回 JSON。
`;
};

const buildRegeneratePrompt = (
  sectionType: SectionType,
  metadata: VideoMetadata
) => {
  const { studentName, bookName, homeworkType } = metadata;

  let specificInstruction = "";

  if (sectionType === "highlights") {
    specificInstruction = `
请只重写“作业亮点”部分。
要求：
1. 用中文输出
2. 至少写出3个具体亮点
3. 语气鼓励、自然
4. 不要输出JSON
5. 不要加星号
`;
  } else if (sectionType === "pronunciation") {
    specificInstruction = `
请只重写“发音评测”部分。
要求：
1. 用中文输出
2. 指出具体发音问题
3. 给出纠正建议
4. 不要输出JSON
5. 不要加星号
`;
  } else {
    specificInstruction = `
请只重写“语法评测”部分。
要求：
1. 用中文输出
2. 指出具体语法问题
3. 给出纠正建议
4. 不要输出JSON
5. 不要加星号
`;
  }

  return `
你是一位资深儿童英语老师。

【学生信息】
学生：${studentName || "同学"}
绘本：${bookName || "未指定"}
作业类型：${homeworkType || "口语练习"}

${specificInstruction}

请直接观看视频，并只输出该板块正文，不要输出JSON，不要加解释。
`;
};

export const analyzeStudentVideo = async (
  videoUrl: string,
  metadata: VideoMetadata = {}
): Promise<AnalysisResult> => {
  try {
    const ai = getAiClient();
    const prompt = buildAnalyzePrompt(metadata);
    const response = await createVideoChatCompletion(ai, prompt, videoUrl, {
      responseFormat: "json_object",
      temperature: 0.2,
    });
    const resultText = extractChatCompletionText(response);
    console.log("AI raw response:", resultText);

    if (!resultText) {
      console.error("AI response had no extractable text");
      throw new Error("AI没有返回可解析文本，可能不支持 chat.completions 视频输入。");
    }

    try {
      const parsed = JSON.parse(extractJson(resultText)) as AnalysisResult;

      return {
        fluency: {
          score: Number(parsed?.fluency?.score ?? 0),
          comment: parsed?.fluency?.comment ?? "AI返回格式异常",
        },
        pronunciation: {
          score: Number(parsed?.pronunciation?.score ?? 0),
          comment: parsed?.pronunciation?.comment ?? "AI返回格式异常",
        },
        intonation: {
          score: Number(parsed?.intonation?.score ?? 0),
          comment: parsed?.intonation?.comment ?? "AI返回格式异常",
        },
        vocabulary: {
          score: Number(parsed?.vocabulary?.score ?? 0),
          comment: parsed?.vocabulary?.comment ?? "AI返回格式异常",
        },
        emotion: {
          score: Number(parsed?.emotion?.score ?? 0),
          comment: parsed?.emotion?.comment ?? "AI返回格式异常",
        },
        overallComment: parsed?.overallComment ?? "AI返回格式异常",
        suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
        grammarSummary: parsed?.grammarSummary ?? "",
      };
    } catch {
      console.error("AI returned non-JSON:", resultText);
      throw new Error(
        `AI返回的不是有效JSON：${resultText.slice(0, 500) || "empty response"}`
      );
    }
  } catch (error) {
    console.error("LLM analyze error:", error);
    console.error("LLM analyze error details:", getErrorDebugMessage(error));

    const message =
      error instanceof Error ? error.message : "Unknown LLM error";

    throw new Error(normalizeAiErrorMessage(message));
  }
};

export const regenerateFeedbackSection = async (
  videoUrl: string,
  sectionType: SectionType,
  metadata: VideoMetadata
): Promise<string> => {
  try {
    const ai = getAiClient();
    const prompt = buildRegeneratePrompt(sectionType, metadata);
    const response = await createVideoChatCompletion(ai, prompt, videoUrl, {
      temperature: 0.4,
    });

    return extractChatCompletionText(response);
  } catch (error) {
    console.error("LLM regenerate error:", error);
    console.error("LLM regenerate error details:", getErrorDebugMessage(error));
    const message =
      error instanceof Error ? error.message : "Unknown LLM error";
    throw new Error(normalizeAiErrorMessage(message));
  }
};
