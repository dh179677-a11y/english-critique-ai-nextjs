import { GoogleGenAI, Schema, Type } from "@google/genai";
import { AnalysisResult } from "@/types";

export interface VideoMetadata {
  studentName?: string;
  bookName?: string;
  homeworkType?: string;
  tutorName?: string;
}

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on server");
  }
  return new GoogleGenAI({ apiKey });
};

const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/ogg",
]);

const getSafeVideoMimeType = (contentType: string | null): string => {
  if (!contentType) return "video/mp4";
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return "video/mp4";
  return ALLOWED_VIDEO_MIME_TYPES.has(normalized) ? normalized : "video/mp4";
};

const fetchVideoAsBase64 = async (
  videoUrl: string,
): Promise<{ base64Video: string; mimeType: string }> => {
  console.log("Fetching video from URL:", videoUrl);

  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch video from URL: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Video = buffer.toString("base64");
  const mimeType = getSafeVideoMimeType(response.headers.get("content-type"));

  console.log("Fetched video:", {
    mimeType,
    sizeBytes: buffer.length,
    base64Length: base64Video.length,
  });

  return { base64Video, mimeType };
};

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    fluency: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: {
          type: Type.STRING,
          description: "Brief summary of fluency IN CHINESE (中文), no asterisks",
        },
      },
      required: ["score", "comment"],
    },
    pronunciation: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: {
          type: Type.STRING,
          description:
            "Brief summary of pronunciation IN CHINESE (中文), no asterisks",
        },
      },
      required: ["score", "comment"],
    },
    intonation: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: {
          type: Type.STRING,
          description: "Brief summary of intonation IN CHINESE (中文), no asterisks",
        },
      },
      required: ["score", "comment"],
    },
    vocabulary: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: {
          type: Type.STRING,
          description:
            "Brief summary of vocabulary usage IN CHINESE (中文), no asterisks",
        },
      },
      required: ["score", "comment"],
    },
    emotion: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: {
          type: Type.STRING,
          description:
            "Brief summary of emotional engagement IN CHINESE (中文), no asterisks",
        },
      },
      required: ["score", "comment"],
    },
    overallComment: {
      type: Type.STRING,
      description:
        "The detailed expert report following the structure. Ensure text is segmented into paragraphs. No asterisks.",
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "List of 3 specific actionable suggestions IN CHINESE. No asterisks.",
    },
    grammarSummary: {
      type: Type.STRING,
      description:
        "A specific educational section summarizing key grammar points in CHINESE. No asterisks.",
    },
  },
  required: [
    "fluency",
    "pronunciation",
    "intonation",
    "vocabulary",
    "emotion",
    "overallComment",
    "suggestions",
    "grammarSummary",
  ],
};

const buildAnalyzePrompt = (metadata: VideoMetadata) => {
  const { studentName, bookName, homeworkType, tutorName } = metadata;

  const nameInstruction = studentName
    ? `Student Name: "${studentName}". Use this name naturally in the evaluation.`
    : "Address the student as '宝贝' or '同学'.";

  return `
Role: You are a senior ESL (English as a Second Language) expert teacher specializing in children's English education with 20 years of experience. You have a keen ear for phonetics, a structured pedagogical approach, and you empower parents to coach their children.

Context Information:
${nameInstruction}
Book Name: ${bookName || "未指定"}
Homework Type: ${homeworkType || "口语练习"}
Tutor Name: ${tutorName || "Teacher"}

Task: Analyze the attached video of a student speaking English. Provide a highly detailed, constructive, and actionable critique.

CRITICAL OUTPUT FORMAT:
1. Language: ALL comments MUST BE IN CHINESE (Simplified).
2. Return STRICT JSON only.
3. Do NOT wrap JSON in markdown code fences.
4. Do NOT add any explanatory text before or after the JSON.
5. Do NOT use asterisks (*) or markdown bolding (**).

Structure for 'overallComment':

1. 作业亮点
   (Identify at least 3 specific strengths. Include specific examples.)

2. 发音评测
   (Identify pronunciation issues in detail.)

3. 语法评测
   (Identify grammar issues in detail.)

4. 整体评价
   (Provide a warm, professional summary using short paragraphs.)

Grammar Summary (grammarSummary):
Identify 1 or 2 key grammar concepts. Explain simply in CHINESE.

Scoring Criteria (0-100) & Brief Comments (IN CHINESE):
- Fluency: Pace, hesitation, self-correction.
- Pronunciation: Clarity, phonemes.
- Intonation: Rhythm, stress, flow.
- Vocabulary: Range, accuracy.
- Emotion: Confidence, engagement.

Output Language: Chinese (Simplified).
`;
};

const buildRegeneratePrompt = (
  sectionType: "highlights" | "pronunciation" | "grammar",
  metadata: VideoMetadata,
) => {
  const { studentName, bookName, homeworkType } = metadata;

  let specificInstruction = "";
  let sectionHeader = "";

  if (sectionType === "highlights") {
    sectionHeader = "1. 作业亮点";
    specificInstruction = `
Focus ONLY on Section 1: Homework Highlights.
Identify at least 3 specific strengths. Include specific examples.
Be enthusiastic.
Output ONLY this section, starting with the header "${sectionHeader}".
Use CHINESE language.
Ensure clear paragraph breaks.
Do NOT use asterisks (*) or markdown bolding (**).
`;
  } else if (sectionType === "pronunciation") {
    sectionHeader = "2. 发音评测";
    specificInstruction = `
Focus ONLY on Section 2: Pronunciation Evaluation.
Identify ALL pronunciation errors.
Format:
> 问题：[Word/Sound] (Timestamp)
- 听感诊断：...
- 问题分析：...
- 纠正方案：...
Output ONLY this section, starting with the header "${sectionHeader}".
Use CHINESE language.
Do NOT use asterisks (*) or markdown bolding (**).
`;
  } else {
    sectionHeader = "3. 语法评测";
    specificInstruction = `
Focus ONLY on Section 3: Grammar Evaluation.
Identify ALL grammar errors.
Format:
> 问题：[Sentence] (Timestamp)
- 问题分析：...
- 纠正方案：...
Output ONLY this section, starting with the header "${sectionHeader}".
Use CHINESE language.
Do NOT use asterisks (*) or markdown bolding (**).
`;
  }

  return `
Role: Senior ESL English Teacher.
Context: Student ${studentName || "Student"}, Book: ${bookName || "未指定"}, Type: ${homeworkType || "口语练习"}.
Task: Re-evaluate ONLY the ${sectionType} section for the attached video.

${specificInstruction}

Output Language: Chinese (Simplified).
Do NOT output JSON. Output plain text.
Strictly NO asterisks (*) allowed in output.
`;
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

export const analyzeStudentVideo = async (
  videoUrl: string,
  metadata: VideoMetadata = {},
): Promise<AnalysisResult> => {
  try {
    const ai = getAiClient();
    const { base64Video, mimeType } = await fetchVideoAsBase64(videoUrl);
    const prompt = buildAnalyzePrompt(metadata);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Video,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const resultText = response.text;
    console.log("AI raw response:", resultText);

    if (!resultText) {
      return safeFallbackResult("AI没有返回内容。");
    }

    try {
      return JSON.parse(resultText) as AnalysisResult;
    } catch (error) {
      console.error("AI returned non-JSON:", resultText);
      return safeFallbackResult(resultText);
    }
  } catch (error) {
    console.error("Gemini analyze error:", error);

    const message =
      error instanceof Error ? error.message : "Unknown Gemini error";

    return safeFallbackResult(`AI分析失败：${message}`);
  }
};

export const regenerateFeedbackSection = async (
  videoUrl: string,
  sectionType: "highlights" | "pronunciation" | "grammar",
  metadata: VideoMetadata,
): Promise<string> => {
  try {
    const ai = getAiClient();
    const { base64Video, mimeType } = await fetchVideoAsBase64(videoUrl);
    const prompt = buildRegeneratePrompt(sectionType, metadata);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Video,
            },
          },
          { text: prompt },
        ],
      },
    });

    return response.text || "";
  } catch (error) {
    console.error("Gemini regenerate error:", error);
    return "AI暂时无法重新生成该部分内容，请稍后重试。";
  }
};
