import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import type { AnalysisResult } from "@/types";

export const runtime = "nodejs";

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured on server`);
  }
  return value;
};

const getAiClient = () =>
  new OpenAI({
    apiKey: getRequiredEnv("LLM_API_KEY"),
    baseURL: getRequiredEnv("LLM_BASE_URL"),
  });

const getModel = () => process.env.LLM_MODEL?.trim() || "gemini-3-pro-preview";

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalizeText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);

const tokenDiceScore = (left: string[], right: string[]) => {
  if (!left.length || !right.length) return 0;
  const rightCount = new Map<string, number>();
  right.forEach((token) => {
    rightCount.set(token, (rightCount.get(token) || 0) + 1);
  });

  let common = 0;
  left.forEach((token) => {
    const count = rightCount.get(token) || 0;
    if (count > 0) {
      common += 1;
      rightCount.set(token, count - 1);
    }
  });
  return (2 * common) / (left.length + right.length);
};

const calcSimilarity = (candidate: string, target: string) => {
  const targetTokens = tokenize(target);
  const candidateTokens = tokenize(candidate);
  if (!targetTokens.length || !candidateTokens.length) return 0;
  return tokenDiceScore(targetTokens, candidateTokens);
};

const buildModelCandidates = () => {
  const envModel = process.env.STORYFLOW_TRANSCRIBE_MODEL?.trim() || "";
  return [envModel, "whisper-1", "gpt-4o-mini-transcribe"].filter(
    (item, index, arr): item is string => Boolean(item) && arr.indexOf(item) === index
  );
};

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
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map(extractTextFromContentPart)
    .filter((value) => value.trim().length > 0)
    .join("\n")
    .trim();
};

const extractJson = (rawText: string) => {
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
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

const parseAnalysisResult = (rawText: string): AnalysisResult => {
  const extracted = extractJson(rawText);
  try {
    return JSON.parse(extracted) as AnalysisResult;
  } catch {
    const repaired = removeTrailingCommas(escapeControlCharsInJsonStrings(extracted));
    return JSON.parse(repaired) as AnalysisResult;
  }
};

const getString = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

const clampScore = (value: number) =>
  Math.max(0, Math.min(100, Math.round(value)));

const buildFallbackResult = (
  transcript: string,
  referenceText: string,
  metadata: {
    studentName: string;
    bookName: string;
    homeworkType: string;
  },
  similarity: number
): AnalysisResult => {
  const completenessScore = clampScore(similarity * 100);
  const pronunciationScore = clampScore(50 + similarity * 42);
  const fluencyScore = clampScore(55 + similarity * 35);
  const intonationScore = clampScore(58 + similarity * 28);
  const vocabularyScore = clampScore(60 + similarity * 20);
  const emotionScore = clampScore(62 + similarity * 18);
  const studentName = metadata.studentName || "同学";

  return {
    fluency: {
      score: fluencyScore,
      comment:
        similarity >= 0.86
          ? "整段跟读整体比较顺，停顿和卡顿控制得还可以。后续可以继续练句间衔接，让整段表达更自然。"
          : "整段跟读已经完成，但流畅度还有提升空间。建议先慢速完整跟读，再逐步提速，减少中途停顿和回读。",
    },
    pronunciation: {
      score: pronunciationScore,
      comment:
        similarity >= 0.86
          ? "大部分词句能被较稳定地识别出来，说明整体发音基础是可以的。接下来重点打磨尾音、重音和长短元音。"
          : "部分词句识别结果与原文有偏差，说明发音清晰度和音素稳定性还需要继续练。建议按句拆读，再回到整段跟读。",
    },
    intonation: {
      score: intonationScore,
      comment:
        similarity >= 0.86
          ? "整段朗读节奏比较完整，但还可以进一步强化句末语气和关键词重音。"
          : "当前更像是在逐词完成朗读，语调起伏和句子节奏还不够明显。建议先听原音，再模仿整句的高低变化。",
    },
    vocabulary: {
      score: vocabularyScore,
      comment: "这次任务以跟读为主，词汇维度重点看是否能稳定读出目标词句。建议把易错词单独抽出来反复跟读。",
    },
    emotion: {
      score: emotionScore,
      comment: "音频里能听出基本完成任务的状态。后续可以在重音、语气词和句末收尾上更大胆一些，让表达更有感染力。",
    },
    overallComment: `${studentName}这次完成了一次整段音频跟读。系统根据整段录音与目标原文的匹配情况进行了综合评价。当前完整度约为 ${completenessScore}/100，说明已经具备整段跟读的基础，但在发音稳定性、连贯度和语调自然度上还有继续打磨的空间。建议后续训练时坚持“先逐句、再整段、再接近原速”的练习顺序。${
      transcript
        ? ` 本次识别到的整段内容为：${transcript}`
        : ""
    }`,
    suggestions: [
      "先逐句录音，确认每句都能稳定读清，再开始整段跟读。",
      "把容易卡住的词单独拆音练 3 次，再放回原句。",
      "每次练习先慢速跟读 1 遍，再按正常速度跟读 1 遍。",
      "重点模仿原音里的句末语气和关键词重音，不要只关注单词本身。",
      "录完后回听自己的整段音频，找出最不自然的 1-2 句重点重录。",
    ],
    grammarSummary: `本次为绘本跟读任务，语法维度主要看是否能完整、准确复现原句结构。建议继续关注原文中的固定句型、冠词和时态表达，并通过整句模仿强化语感。`,
  };
};

const buildPrompt = (input: {
  studentName: string;
  bookName: string;
  homeworkType: string;
  tutorName: string;
  referenceText: string;
  transcript: string;
  similarity: number;
}) => `
你是一位资深儿童英语老师，现在需要基于“整段音频转写结果”和“目标原文”来给学生做一次音频版 EnglishPro Critique AI 点评。

【学生信息】
学生：${input.studentName || "同学"}
绘本：${input.bookName || "未指定"}
作业类型：${input.homeworkType || "绘本跟读"}
辅导老师：${input.tutorName || "Teacher"}

【重要说明】
1. 你拿到的是整段音频转写结果，不是视频。
2. 不要评价表情、肢体、镜头感、口型等视频维度。
3. 你必须聚焦：流畅度、发音稳定性、语调、完整度、跟读表现。
4. 所有 comment 和说明文字必须用中文。
5. 只能返回 JSON。
6. 分数范围 0-100，必须是整数。

【目标原文】
${input.referenceText}

【音频转写结果】
${input.transcript || "(empty)"}

【整体文本匹配度】
${Math.round(input.similarity * 100)}/100

【JSON格式必须严格如下】
{
  "fluency": { "score": 0, "comment": "" },
  "pronunciation": { "score": 0, "comment": "" },
  "intonation": { "score": 0, "comment": "" },
  "vocabulary": { "score": 0, "comment": "" },
  "emotion": { "score": 0, "comment": "" },
  "overallComment": "",
  "suggestions": ["", "", "", "", ""],
  "grammarSummary": ""
}

【评分要求】
- fluency：是否连贯，是否有较多停顿、回读、卡顿
- pronunciation：根据转写和原文偏差，评估发音清晰度和稳定性
- intonation：根据句子完成情况和表达自然度，评估语调与节奏
- vocabulary：本次跟读是否能较完整、准确读出目标词汇
- emotion：仅评价声音表达状态、自信度、投入感，不要提视频动作

【overallComment要求】
- 用中文写 2 段以上
- 必须点名学生
- 第一段总结整段跟读完成度和主要问题
- 第二段给出具体训练建议

【suggestions要求】
- 返回 5 条
- 每条都要可执行

【grammarSummary要求】
- 用中文总结 2-4 个最值得关注的句型/表达点
- 不要编造视频内容
`;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const referenceText = getString(formData.get("referenceText"));
    const studentName = getString(formData.get("studentName"));
    const bookName = getString(formData.get("bookName"));
    const homeworkType = getString(formData.get("homeworkType")) || "绘本跟读";
    const tutorName = getString(formData.get("tutorName"));

    if (!(audioFile instanceof File)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }
    if (!referenceText) {
      return NextResponse.json({ error: "referenceText is required" }, { status: 400 });
    }

    const ai = getAiClient();
    const fileBuffer = Buffer.from(await audioFile.arrayBuffer());
    const uploadFile = await toFile(fileBuffer, audioFile.name || "storyflow-reading.wav", {
      type: audioFile.type || "audio/wav",
    });

    const models = buildModelCandidates();
    let transcript = "";
    let lastTranscriptionError: unknown = null;

    for (const model of models) {
      try {
        const transcription = await ai.audio.transcriptions.create({
          model,
          file: uploadFile,
          response_format: "verbose_json",
          timestamp_granularities: ["segment"],
        } as never);
        const raw = transcription as { text?: unknown };
        transcript = typeof raw.text === "string" ? raw.text.trim() : "";
      } catch (error) {
        lastTranscriptionError = error;
        try {
          const fallback = await ai.audio.transcriptions.create({
            model,
            file: uploadFile,
          } as never);
          const raw = fallback as { text?: unknown };
          transcript = typeof raw.text === "string" ? raw.text.trim() : "";
        } catch (fallbackError) {
          lastTranscriptionError = fallbackError;
        }
      }

      if (transcript) break;
    }

    if (!transcript) {
      throw lastTranscriptionError || new Error("音频转写失败");
    }

    const similarity = calcSimilarity(transcript, referenceText);
    const fallbackResult = buildFallbackResult(
      transcript,
      referenceText,
      {
        studentName,
        bookName,
        homeworkType,
      },
      similarity
    );

    try {
      const response = await ai.chat.completions.create({
        model: getModel(),
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: buildPrompt({
              studentName,
              bookName,
              homeworkType,
              tutorName,
              referenceText,
              transcript,
              similarity,
            }),
          },
        ],
      } as never);

      const rawText = extractChatCompletionText(response);
      const result = parseAnalysisResult(rawText);
      return NextResponse.json({
        result,
        transcript,
        similarity,
      });
    } catch (llmError) {
      console.error("Storyflow score-audio llm fallback:", llmError);
      return NextResponse.json({
        result: fallbackResult,
        transcript,
        similarity,
      });
    }
  } catch (error) {
    console.error("Storyflow score-audio route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "音频评分失败" },
      { status: 500 }
    );
  }
}
