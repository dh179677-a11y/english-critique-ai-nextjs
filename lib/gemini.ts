import OpenAI from "openai";
import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/ogg",
]);

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

const normalizeMimeType = (
  contentType: string | null | undefined,
  fallback = "video/mp4"
): string => {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ALLOWED_VIDEO_MIME_TYPES.has(normalized) ? normalized : fallback;
};

const inferMimeTypeFromPathname = (pathname: string): string => {
  const normalized = pathname.toLowerCase();

  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".mkv")) return "video/x-matroska";
  if (normalized.endsWith(".ogg")) return "video/ogg";

  return "video/mp4";
};

const sanitizeFilename = (pathname: string, mimeType: string): string => {
  const rawName = pathname.split("/").pop()?.trim() || "";
  const cleaned = rawName.replace(/[^a-zA-Z0-9._-]/g, "");

  if (cleaned) {
    return cleaned;
  }

  if (mimeType === "video/quicktime") return `video-${Date.now()}.mov`;
  if (mimeType === "video/webm") return `video-${Date.now()}.webm`;
  if (mimeType === "video/x-matroska") return `video-${Date.now()}.mkv`;
  if (mimeType === "video/ogg") return `video-${Date.now()}.ogg`;

  return `video-${Date.now()}.mp4`;
};

const assertSupportedVideoUrl = (videoUrl: string): URL => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    throw new Error("videoUrl is invalid");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("videoUrl must use https");
  }

  const isAllowedHost = ALLOWED_BLOB_HOST_SUFFIXES.some((suffix) =>
    parsedUrl.hostname.endsWith(suffix)
  );

  if (!isAllowedHost) {
    throw new Error("videoUrl host is not allowed");
  }

  return parsedUrl;
};

const downloadVideoInput = async (videoUrl: string) => {
  const parsedUrl = assertSupportedVideoUrl(videoUrl);
  const fallbackMimeType = inferMimeTypeFromPathname(parsedUrl.pathname);
  const response = await fetch(parsedUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }

  const mimeType = normalizeMimeType(
    response.headers.get("content-type"),
    fallbackMimeType
  );
  const arrayBuffer = await response.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString("base64");

  return {
    filename: sanitizeFilename(parsedUrl.pathname, mimeType),
    fileData: `data:${mimeType};base64,${base64Data}`,
  };
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

const extractTextFromOutput = (response: Record<string, unknown>): string => {
  const output = response.output;

  if (!Array.isArray(output)) {
    return "";
  }

  const texts = output.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .map(extractTextFromContentPart)
      .filter((value) => typeof value === "string" && value.trim().length > 0);
  });

  return texts.join("\n").trim();
};

const extractTextFromChoices = (response: Record<string, unknown>): string => {
  const choices = response.choices;

  if (!Array.isArray(choices)) {
    return "";
  }

  const texts = choices.flatMap((choice) => {
    if (!choice || typeof choice !== "object") {
      return [];
    }

    const message = (choice as { message?: unknown }).message;

    if (!message || typeof message !== "object") {
      return [];
    }

    const content = (message as { content?: unknown }).content;

    if (typeof content === "string") {
      return [content];
    }

    if (!Array.isArray(content)) {
      return [];
    }

    return content
      .map(extractTextFromContentPart)
      .filter((value) => typeof value === "string" && value.trim().length > 0);
  });

  return texts.join("\n").trim();
};

const extractResponseText = (
  response: Awaited<ReturnType<OpenAI["responses"]["create"]>>
) => {
  if ("output_text" in response && typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  if (response && typeof response === "object") {
    const looseResponse = response as unknown as Record<string, unknown>;
    const outputText = extractTextFromOutput(looseResponse);

    if (outputText) {
      return outputText;
    }

    const choiceText = extractTextFromChoices(looseResponse);

    if (choiceText) {
      return choiceText;
    }
  }

  return "";
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
    const videoInput = await downloadVideoInput(videoUrl);
    const response = await ai.responses.create({
      model: getModel(),
      text: {
        format: {
          type: "json_object",
        },
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            {
              type: "input_file",
              filename: videoInput.filename,
              file_data: videoInput.fileData,
            },
          ],
        },
      ],
    });

    const resultText = extractResponseText(response);
    console.log("AI raw response:", resultText);

    if (!resultText) {
      console.error("AI response had no extractable text");
      throw new Error("AI没有返回可解析文本，可能不支持 Responses API 或 input_file");
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

    const message =
      error instanceof Error ? error.message : "Unknown LLM error";

    throw new Error(message);
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
    const videoInput = await downloadVideoInput(videoUrl);
    const response = await ai.responses.create({
      model: getModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            {
              type: "input_file",
              filename: videoInput.filename,
              file_data: videoInput.fileData,
            },
          ],
        },
      ],
    });

    return extractResponseText(response);
  } catch (error) {
    console.error("LLM regenerate error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown LLM error";
    throw new Error(message);
  }
};
