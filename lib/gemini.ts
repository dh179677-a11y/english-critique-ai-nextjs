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

const fileToBase64 = async (file: File): Promise<string> => {
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("base64");
};

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    fluency: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: { type: Type.STRING, description: "Brief summary of fluency IN CHINESE (中文), no asterisks" },
      },
      required: ["score", "comment"],
    },
    pronunciation: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: { type: Type.STRING, description: "Brief summary of pronunciation IN CHINESE (中文), no asterisks" },
      },
      required: ["score", "comment"],
    },
    intonation: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: { type: Type.STRING, description: "Brief summary of intonation IN CHINESE (中文), no asterisks" },
      },
      required: ["score", "comment"],
    },
    vocabulary: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: { type: Type.STRING, description: "Brief summary of vocabulary usage IN CHINESE (中文), no asterisks" },
      },
      required: ["score", "comment"],
    },
    emotion: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: "Score out of 100" },
        comment: { type: Type.STRING, description: "Brief summary of emotional engagement IN CHINESE (中文), no asterisks" },
      },
      required: ["score", "comment"],
    },
    overallComment: {
      type: Type.STRING,
      description: "The detailed expert report following the structure. Ensure text is segmented into paragraphs. No asterisks.",
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of 3 specific actionable suggestions IN CHINESE. No asterisks.",
    },
    grammarSummary: {
      type: Type.STRING,
      description: "A specific educational section summarizing key grammar points in CHINESE. No asterisks.",
    },
  },
  required: ["fluency", "pronunciation", "intonation", "vocabulary", "emotion", "overallComment", "suggestions", "grammarSummary"],
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

    CRITICAL OUTPUT FORMAT (Style Reference):
    1. Language: ALL comments, including the brief summaries for Fluency, Pronunciation, etc., MUST BE IN CHINESE (Simplified).
    2. Structure: You must follow the structure in the 'overallComment' field strictly.
    3. Spacing: Use DOUBLE NEWLINES to separate paragraphs within the "Overall Evaluation" and "Highlights" sections to ensure the text is well-segmented and easy to read.
    4. Formatting: Do NOT use asterisks (*) or markdown bolding (**). Use plain text or the symbols specified below.

    Structure for 'overallComment':

    (Do NOT include a 'Video Info' or 'Basic Information' section. Start directly with Section 1.)

    1. 作业亮点 (Homework Highlights)
       (Identify at least 3 specific strengths. Use paragraph breaks between distinct points. Include specific examples:
        - Specific sentences/segments read well.
        - Emotion/intonation spots.
        - Confidence/gestures.
        Be enthusiastic.)

    2. 发音评测 (Pronunciation Evaluation)
       (Identify ALL pronunciation errors. Be extremely detailed.)
       > 问题：[Word/Sound] (Timestamp e.g. 00:15)
         - 听感诊断：[What was heard vs Correct sound]
         - 问题分析：[Why it happened]
         - 纠正方案：[Specific physical action]

    3. 语法评测 (Grammar Evaluation)
       (Catch ALL specific grammar errors.)
       > 问题：[Incorrect Sentence] (Timestamp)
         - 问题分析：[Grammar rule violation explanation]
         - 纠正方案：[Correct Sentence and brief rule]

    4. 整体评价 (Overall Evaluation)
       (Provide a comprehensive professional summary. IMPORTANT: Use multiple SHORT paragraphs separated by empty lines. Do not write one giant block of text. Summarize specific problems found in Sections 2 & 3. Address the parent/student warmly.)

    Grammar Summary (grammarSummary):
    Identify 1 or 2 key grammar concepts. Explain simply in CHINESE.

    Scoring Criteria (0-100) & Brief Comments (IN CHINESE):
    - Fluency: Pace, hesitation, self-correction.
    - Pronunciation: Clarity, phonemes (th, v/w, vowels).
    - Intonation: Rhythm, stress, flow.
    - Vocabulary: Range, accuracy.
    - Emotion: Confidence, engagement.

    Output Language: Chinese (Simplified).
  `;
};

const buildRegeneratePrompt = (sectionType: "highlights" | "pronunciation" | "grammar", metadata: VideoMetadata) => {
  const { studentName, bookName, homeworkType } = metadata;

  let specificInstruction = "";
  let sectionHeader = "";

  if (sectionType === "highlights") {
    sectionHeader = "1. 作业亮点 (Homework Highlights)";
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
    sectionHeader = "2. 发音评测 (Pronunciation Evaluation)";
    specificInstruction = `
      Focus ONLY on Section 2: Pronunciation Evaluation.
      Identify ALL pronunciation errors. NO LIMIT on quantity.
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
    sectionHeader = "3. 语法评测 (Grammar Evaluation)";
    specificInstruction = `
      Focus ONLY on Section 3: Grammar Evaluation.
      Identify ALL grammar errors. NO LIMIT on quantity.
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

export const analyzeStudentVideo = async (videoFile: File, metadata: VideoMetadata = {}): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const base64Video = await fileToBase64(videoFile);
  const prompt = buildAnalyzePrompt(metadata);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: videoFile.type,
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
  if (!resultText) {
    throw new Error("No response from AI");
  }

  return JSON.parse(resultText) as AnalysisResult;
};

export const regenerateFeedbackSection = async (
  videoFile: File,
  sectionType: "highlights" | "pronunciation" | "grammar",
  metadata: VideoMetadata,
): Promise<string> => {
  const ai = getAiClient();
  const base64Video = await fileToBase64(videoFile);
  const prompt = buildRegeneratePrompt(sectionType, metadata);

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: videoFile.type,
            data: base64Video,
          },
        },
        { text: prompt },
      ],
    },
  });

  return response.text || "";
};
