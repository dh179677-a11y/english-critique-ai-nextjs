import OpenAI from "openai";
import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

type SectionType = "highlights" | "pronunciation" | "grammar";

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

const safeFallbackResult = (rawText: string): AnalysisResult => {
  return {
    fluency: { score: 0, comment: "AI返回格式异常" },
    pronunciation: { score: 0, comment: "AI返回格式异常" },
    intonation: { score: 0, comment: "AI返回格式异常" },
    vocabulary: { score: 0, comment: "AI返回格式异常" },
    emotion: { score: 0, comment: "AI返回格式异常" },
    overallComment: rawText || "AI暂时未返回标准结果，请稍后重试。",
    suggestions: [],
    grammarSummary: "",
  };
};

const buildAnalyzePrompt = (
  transcript: string,
  metadata: VideoMetadata
) => {
  const { studentName, bookName, homeworkType, tutorName } = metadata;

  const nameInstruction = studentName
    ? `学生姓名：${studentName}。请在评价中自然使用这个名字。`
    : `如果没有学生姓名，请使用“同学”称呼。`;

  return `
你是一位有20年经验的儿童英语口语测评专家。

请基于下面这段学生英文口语转写文本，进行专业、细致、可执行的点评。

【基础信息】
${nameInstruction}
绘本名称：${bookName || "未指定"}
作业类型：${homeworkType || "口语练习"}
辅导老师：${tutorName || "Teacher"}

【学生口语转写文本】
${transcript}

【任务要求】
请根据这段英文口语内容，输出以下结构化评分与点评。

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
  transcript: string,
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

【学生英文口语转写文本】
${transcript}

${specificInstruction}

直接输出正文，不要输出JSON，不要加解释。
`;
};

export const analyzeStudentVideo = async (
  transcript: string,
  metadata: VideoMetadata = {}
): Promise<AnalysisResult> => {
  try {
    const ai = getAiClient();
    const prompt = buildAnalyzePrompt(transcript, metadata);

    const response = await ai.chat.completions.create({
      model: getModel(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你是英语口语评分助手，只返回合法 JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const resultText = response.choices[0]?.message?.content || "";
    console.log("AI raw response:", resultText);

    if (!resultText) {
      return safeFallbackResult("AI没有返回内容。");
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
    } catch (error) {
      console.error("AI returned non-JSON:", resultText);
      return safeFallbackResult(resultText);
    }
  } catch (error) {
    console.error("LLM analyze error:", error);

    const message =
      error instanceof Error ? error.message : "Unknown LLM error";

    return safeFallbackResult(`AI分析失败：${message}`);
  }
};

export const regenerateFeedbackSection = async (
  transcript: string,
  sectionType: SectionType,
  metadata: VideoMetadata
): Promise<string> => {
  try {
    const ai = getAiClient();
    const prompt = buildRegeneratePrompt(transcript, sectionType, metadata);

    const response = await ai.chat.completions.create({
      model: getModel(),
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "你是英语口语点评助手，只输出正文，不输出JSON。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("LLM regenerate error:", error);
    return "AI暂时无法重新生成该部分内容，请稍后重试。";
  }
};