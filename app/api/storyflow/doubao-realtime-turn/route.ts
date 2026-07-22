import { createRequire } from "module";
import { NextResponse } from "next/server";
import { agentLessonFlowPrompt } from "@/lib/agentLessonFlow";

export const runtime = "nodejs";

type RealtimeTurnRequest = {
  message?: string;
  studentMessage?: string;
  audioPcmBase64?: string;
  ttsText?: string;
  ttsSpeaker?: string;
  voiceId?: string;
  mode?: "shadow" | "speaking";
  bookTitle?: string;
  pageLabel?: string;
  pageText?: string;
  visiblePrompt?: string;
  aiTeachingContext?: {
    currentPageText?: string;
    previousPageText?: string;
    nextPageText?: string;
    allPageTexts?: Array<{
      pageLabel?: string;
      text?: string;
    }>;
    currentPageSegments?: Array<{
      label?: string;
      text?: string;
    }>;
    visibleToStudent?: "image_only" | "hint" | "original";
    instruction?: string;
    pronunciationTarget?: string;
    visualDescription?: string;
    characterProfile?: string;
    lessonState?: string;
  };
  pronunciationTarget?: string;
  coachHistory?: Array<{
    role?: "student" | "coach";
    text?: string;
  }>;
  navigationContext?: {
    canGoNext?: boolean;
    nextPageLabel?: string;
    nextPageText?: string;
    lastAssistantAskedNext?: boolean;
    frontendWillAutoAdvanceOnAgreement?: boolean;
  };
  uiControlContext?: {
    practiceStatus?: string;
    hintStage?: number;
    pendingAction?: string;
    allowedAutoActions?: string[];
    requiresConfirmationActions?: string[];
  };
};

type WsLike = {
  send: (data: Buffer) => void;
  close: () => void;
  on: (event: "open" | "message" | "error" | "close", handler: (...args: unknown[]) => void) => void;
};

const nodeRequire = createRequire(import.meta.url);
// Next's webpack runtime can resolve ws optional native helpers incorrectly.
// Force ws to use its pure-JS masking path for server-side realtime proxying.
process.env.WS_NO_BUFFER_UTIL = "true";
process.env.WS_NO_UTF_8_VALIDATE = "true";

const EVENTS = {
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  EndASR: 400,
  ChatTextQuery: 501,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  SessionStarted: 150,
  SessionFailed: 153,
  ASRInfo: 450,
  ASRResponse: 451,
  ASREnded: 459,
  TTSResponse: 352,
  TTSEnded: 359,
  ChatResponse: 550,
  ChatEnded: 559,
  ChatTextQueryConfirmed: 553,
  DialogCommonError: 599,
} as const;

const SESSION_EVENTS = new Set<number>([
  EVENTS.SessionStarted,
  EVENTS.SessionFailed,
  EVENTS.ASRInfo,
  EVENTS.ASRResponse,
  EVENTS.ASREnded,
  EVENTS.TTSResponse,
  EVENTS.TTSEnded,
  EVENTS.ChatResponse,
  EVENTS.ChatEnded,
  EVENTS.ChatTextQueryConfirmed,
  EVENTS.DialogCommonError,
]);

const trimText = (value: unknown, maxLength = 900) => {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const normalizeReferenceText = (value: unknown, maxLength = 420) =>
  trimText(value, maxLength)
    .toLowerCase()
    .replace(/\.(pdf|docx?|jpe?g|png|webp)\b/gi, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isFileReferenceText = (value: unknown, sourceName?: unknown) => {
  const text = trimText(value, 420);
  if (!text) return false;
  if (/\.(pdf|docx?|jpe?g|png|webp)\b/i.test(text)) return true;

  const textKey = normalizeReferenceText(text);
  const sourceKey = normalizeReferenceText(sourceName);
  return Boolean(textKey && sourceKey && textKey === sourceKey);
};

const sanitizeTeachingText = (
  value: unknown,
  sourceName?: unknown,
  maxLength = 900
) => {
  const text = trimText(value, maxLength);
  if (!text) return "";
  if (/^\d{1,4}$/.test(text.replace(/\s+/g, ""))) return "";
  if (isFileReferenceText(text, sourceName)) return "";
  return text;
};

const DEFAULT_TTS_SPEAKER = "zh_female_vv_jupiter_bigtts";
const ALLOWED_TTS_SPEAKERS = new Set([
  DEFAULT_TTS_SPEAKER,
  "zh_female_cancan_mars_bigtts",
  "zh_male_yunxi_moon_bigtts",
]);

const getTtsSpeaker = (payload: RealtimeTurnRequest) => {
  const requested = trimText(payload.ttsSpeaker || payload.voiceId, 80);
  if (ALLOWED_TTS_SPEAKERS.has(requested)) return requested;
  const envSpeaker = getEnv("DOUBAO_TTS_SPEAKER");
  return envSpeaker || DEFAULT_TTS_SPEAKER;
};

const getTeachingContextText = (payload: RealtimeTurnRequest, maxLength = 900) =>
  sanitizeTeachingText(
    payload.aiTeachingContext?.currentPageText || payload.pageText,
    payload.bookTitle,
    maxLength
  );

const buildCoachHistoryPrompt = (payload: RealtimeTurnRequest) => {
  if (!Array.isArray(payload.coachHistory) || !payload.coachHistory.length) return "";
  const history = payload.coachHistory
    .slice(-8)
    .map((item) => {
      const text = trimText(item?.text, 180);
      if (!text) return "";
      return `${item?.role === "coach" ? "AI老师" : "孩子"}：${text}`;
    })
    .filter(Boolean)
    .join("\n");
  return history ? `【最近对话历史】\n${history}` : "";
};

const COACH_CORRECTION_PATTERN = /(再试|再读|重读|纠音|纠正|发音|重音|节奏|注意|口型|尾音|连读)/;

const buildCorrectionPacingPrompt = (payload: RealtimeTurnRequest) => {
  const recentCorrectionTurns = Array.isArray(payload.coachHistory)
    ? payload.coachHistory
        .slice(-8)
        .filter((item) => item?.role === "coach" && COACH_CORRECTION_PATTERN.test(trimText(item?.text, 240)))
        .length
    : 0;

  return [
    "【纠音节奏规则】",
    "同一个单词、句子或发音细节最多连续纠正 3 轮；不要为了追求完美一直让孩子重读。",
    "每轮最多指出 1 个最重要的发音、重音或节奏点；轻微问题可以直接放过。",
    "第 1-2 次可以温和示范并邀请孩子再试；第 3 次必须作为最后一次提示。",
    "如果最近已经反复纠正或要求重读 3 次及以上，必须停止继续纠同一个点，改为给一句具体练习建议、一句鼓励，然后推进下一句或下一页。",
    "优先保持孩子愿意开口、愿意继续学，不要让互动卡在一个细节上。",
    `最近 AI 老师纠音/要求重读倾向次数：${recentCorrectionTurns}。${
      recentCorrectionTurns >= 3
        ? "这次不要再要求孩子重读同一个点，请鼓励并推进。"
        : "如果需要纠音，也要保持简短。"
    }`,
  ].join("\n");
};

const getPronunciationTarget = (payload: RealtimeTurnRequest, maxLength = 120) =>
  trimText(payload.aiTeachingContext?.pronunciationTarget || payload.pronunciationTarget, maxLength);

const buildPronunciationTargetPrompt = (payload: RealtimeTurnRequest) => {
  const target = getPronunciationTarget(payload);
  if (!target) return "";
  return [
    "【本轮朗读目标】",
    `孩子这一轮是在朗读：${target}`,
    "必须先回应这次朗读是否接近目标词/句，再给 1 个最重要的发音建议。",
    "不要把这轮当成普通问答，也不要重新解释这个词的意思，除非孩子明确问意思。",
    "如果识别到的孩子语音和目标差很多，可以温和说“我听起来还不太像”，然后示范一次。",
  ].join("\n");
};

const buildNavigationPrompt = (payload: RealtimeTurnRequest) => {
  const context = payload.navigationContext;
  if (!context) return "";
  return [
    "【页面导航状态】",
    `是否可以进入下一页：${context.canGoNext ? "可以" : "不可以"}`,
    context.nextPageLabel ? `下一页：${trimText(context.nextPageLabel, 80)}` : "",
    context.nextPageText ? `下一页后台原文：${trimText(context.nextPageText, 360)}` : "",
    context.lastAssistantAskedNext
      ? "上一轮 AI 老师已经邀请孩子进入下一页。如果孩子本轮回答“好的/可以/OK/yes/嗯”等同意词，要理解为同意翻页，不要再要求孩子读当前页。"
      : "",
    context.frontendWillAutoAdvanceOnAgreement
      ? "前端会在孩子同意后自动翻到下一页。你的回复应顺着下一页练习说，例如“好的，我们看下一页，先看图片说说发生了什么”。"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildUiControlPrompt = (payload: RealtimeTurnRequest) => {
  const context = payload.uiControlContext;
  if (!context) return "";
  const autoActions = Array.isArray(context.allowedAutoActions)
    ? context.allowedAutoActions.filter(Boolean).join(" / ")
    : "";
  const confirmationActions = Array.isArray(context.requiresConfirmationActions)
    ? context.requiresConfirmationActions.filter(Boolean).join(" / ")
    : "";
  return [
    "【页面半自动控制规则】",
    `练习状态：${trimText(context.practiceStatus, 40) || "unknown"}`,
    `提示阶段：${Number(context.hintStage || 0)}`,
    context.pendingAction ? `正在等待孩子确认的页面动作：${trimText(context.pendingAction, 60)}` : "",
    autoActions ? `你可以自动触发的动作：${autoActions}` : "当前没有可自动触发的动作",
    confirmationActions
      ? `必须先问孩子确认才能触发的动作：${confirmationActions}`
      : "当前没有需要确认的动作",
    "看图说话进入页面后会自动开始记录，不要再要求孩子点击开始练习，也不要提倒计时。",
    "默认状态就是只看图片；不要要求前端切回只看图片。",
    "如果你想让前端自动打开提示，只能明确说“我帮你打开提示”。",
    "显示原文/答案不能自动打开；你只能问“要不要显示原文？”孩子回答好的/可以/yes 后，前端才会打开。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildTeachingContextPrompt = (payload: RealtimeTurnRequest) => {
  const context = payload.aiTeachingContext;
  const currentPageText = getTeachingContextText(payload, 900);
  const previousPageText = sanitizeTeachingText(context?.previousPageText, payload.bookTitle, 260);
  const nextPageText = sanitizeTeachingText(context?.nextPageText, payload.bookTitle, 260);
  const visibleToStudent = context?.visibleToStudent || "image_only";
  const visualDescription = trimText(context?.visualDescription, 900);
  const instruction =
    trimText(context?.instruction, 420) ||
    "这些原文是 AI 教师后台上下文，学生不一定看得到。请用它们引导孩子回忆和复述原文，但不要直接泄露完整答案。";
  const allPageTexts = Array.isArray(context?.allPageTexts)
    ? context.allPageTexts
        .map((item, index) => {
          const pageLabel = trimText(item?.pageLabel, 40) || `第 ${index + 1} 页`;
          const text = sanitizeTeachingText(item?.text, payload.bookTitle, 140);
          return text ? `${pageLabel}: ${text}` : "";
        })
        .filter(Boolean)
        .join(" | ")
    : "";
  const currentPageSegments = Array.isArray(context?.currentPageSegments)
    ? context.currentPageSegments
        .map((item, index, segments) => {
          const label = trimText(item?.label, 40);
          const text = sanitizeTeachingText(item?.text, payload.bookTitle, 420);
          const sideLabel =
            segments.length >= 2
              ? index === 0
                ? "左页"
                : index === 1
                  ? "右页"
                  : `第 ${index + 1} 段`
              : "当前可见页";
          return text ? `${sideLabel}${label ? `（绘本原页 ${label}）` : ""}: ${text}` : "";
        })
        .filter(Boolean)
        .join(" -> ")
    : "";

  return [
    "【AI教师后台原文上下文】",
    `学生当前可见状态：${visibleToStudent === "original" ? "已显示原文" : visibleToStudent === "hint" ? "只显示提示，不显示完整原文" : "只看图片，不显示原文"}`,
    `当前页后台原文：${currentPageText || "暂无"}`,
    visualDescription ? `当前屏幕/资料页视觉摘要：${visualDescription}` : "",
    currentPageSegments ? `当前可见页面分段原文：${currentPageSegments}` : "",
    previousPageText ? `上一页后台原文：${previousPageText}` : "",
    nextPageText ? `下一页后台原文：${nextPageText}` : "",
    allPageTexts ? `全书页码原文索引：${trimText(allPageTexts, 1100)}` : "",
    `使用规则：${instruction}`,
    "如果孩子要求“读这一页/读这页句子/读原文/读正文”，必须完整朗读当前页后台原文，从第一句开始逐句读；如果当前可见页面分段原文存在，要按分段顺序逐段朗读，不要漏掉第一句。",
    "分段里的“左页/右页/绘本原页/当前可见页”等标签只用于内部判断阅读顺序，朗读或回答时不要把这些标签念给学生听。",
    "双页展开的阅读顺序必须是：先读完左页全部正文，再读右页全部正文。不要按整张图片横向扫描，不要把左页第一行后面直接接右页第一行。",
    "如果孩子说“第二页/第三页”等页码，而当前可见页面分段原文里有对应的绘本原页码，必须按绘本原页码理解，不要按资料页序号理解。",
    "除非学生当前已显示原文，或明确要求答案，否则你只能用问题、关键词、首字母、完形提示、发音示范来引导，不要直接完整说出当前页原文。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildCharacterProfilePrompt = (payload: RealtimeTurnRequest) => {
  const profile = trimText(payload.aiTeachingContext?.characterProfile, 1800);
  if (!profile) return "";
  return [
    "【人物识别参考】",
    profile,
    "使用人物卡时必须谨慎：只有画面特征或页面文字支持时才使用角色名；不确定时说“可能是”，不要把参考资料当成画面事实。",
  ].join("\n");
};

const buildAgentLessonStatePrompt = (payload: RealtimeTurnRequest) => {
  const state = trimText(payload.aiTeachingContext?.lessonState, 900);
  return state ? `${state}\n请优先遵循这个当前步骤，不要跳到后续步骤。` : "";
};

const getEnv = (name: string) => process.env[name]?.trim() || "";

const writeUInt32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const buildFullClientPayload = (
  event: number,
  payload: Record<string, unknown>,
  sessionId?: string
) => {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  const chunks = [header, writeUInt32(event)];
  if (sessionId) {
    const sessionBuffer = Buffer.from(sessionId, "utf8");
    chunks.push(writeUInt32(sessionBuffer.length), sessionBuffer);
  }
  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  chunks.push(writeUInt32(payloadBuffer.length), payloadBuffer);
  return Buffer.concat(chunks);
};

const buildAudioClientPayload = (event: number, audio: Buffer, sessionId: string) => {
  const header = Buffer.from([0x11, 0x24, 0x10, 0x00]);
  const sessionBuffer = Buffer.from(sessionId, "utf8");
  return Buffer.concat([
    header,
    writeUInt32(event),
    writeUInt32(sessionBuffer.length),
    sessionBuffer,
    writeUInt32(audio.length),
    audio,
  ]);
};

const parseServerPayload = (input: Buffer) => {
  if (input.length < 8) return null;
  const messageType = input[1] >> 4;
  const flags = input[1] & 0x0f;
  const serialization = input[2] >> 4;
  let offset = 4;

  if (messageType === 0x0f) {
    const code = input.length >= offset + 4 ? input.readUInt32BE(offset) : 0;
    offset += 4;
    const payloadSize = input.length >= offset + 4 ? input.readUInt32BE(offset) : 0;
    offset += 4;
    const errorText = input.subarray(offset, offset + payloadSize).toString("utf8");
    return { event: 0, error: errorText || `Realtime error ${code}`, payload: null, audio: null };
  }

  let event = 0;
  if (flags === 0x04 && input.length >= offset + 4) {
    event = input.readUInt32BE(offset);
    offset += 4;
  }

  let sessionId = "";
  if (SESSION_EVENTS.has(event) && input.length >= offset + 4) {
    const sessionIdSize = input.readUInt32BE(offset);
    if (sessionIdSize > 0 && sessionIdSize < 128 && input.length >= offset + 4 + sessionIdSize) {
      offset += 4;
      sessionId = input.subarray(offset, offset + sessionIdSize).toString("utf8");
      offset += sessionIdSize;
    }
  }

  const payloadSize = input.length >= offset + 4 ? input.readUInt32BE(offset) : 0;
  offset += 4;
  const payloadBytes = input.subarray(offset, offset + payloadSize);
  if (messageType === 0x0b || serialization === 0x00) {
    return { event, sessionId, payload: null, audio: payloadBytes, error: "" };
  }

  const payloadText = payloadBytes.toString("utf8");
  try {
    return { event, sessionId, payload: JSON.parse(payloadText) as unknown, audio: null, error: "" };
  } catch {
    return { event, sessionId, payload: payloadText, audio: null, error: "" };
  }
};

const buildSystemRole = (payload: RealtimeTurnRequest) => {
  const ttsText = trimText(payload.ttsText, 1200);
  if (ttsText) {
    return [
      "你是 Mia 老师的语音播报器，只负责把指定文本自然地读出来。",
      "必须严格围绕指定播报文本，不要新增讲解、不要改写内容、不要切换成别的人设。",
      `指定播报文本：${ttsText}`,
    ].join("\n");
  }
  const mode = payload.mode === "shadow" ? "影子跟读" : "看图说话";
  const isAgentMaterial =
    /Agent|自学资料|自己上传|上传的学习资料/.test(
      `${payload.bookTitle || ""} ${payload.aiTeachingContext?.instruction || ""}`
    );
  const bilingualCoachRules = [
    "【语言状态规则，最高优先级】",
    "你始终保持“中文主导 + 必要英文示范”的双语老师状态。",
    "英文朗读输入不是英文聊天。孩子说英文时，优先判断为正在读绘本原句、练习英文表达或询问某个英文词，不要因此切换成纯英文回复。",
    "如果孩子读的是当前目标原文或相近句子，必须像老师点评朗读：先用中文鼓励，再用中文指出一个发音、重音或节奏点，只引用必要的英文词或短句示范，最后用中文引导继续。",
    "如果孩子用中文提问，就用中文回答；如果孩子中英文混说，也保持中文解释 + 少量英文关键词。",
    "只有孩子明确说“请全英文回答”“English only”“speak only English”时，才可以全英文。",
  ].join("\n");
  return [
    isAgentMaterial
      ? "你是一个真人感很强的儿童英语 AI 陪学老师，语气自然、温柔、活泼，像耐心的少儿英语老师。"
      : "你是一个真人感很强的儿童英语绘本 AI 语音教练，语气自然、温柔、活泼，像耐心的少儿英语老师。",
    `当前任务是${isAgentMaterial ? "Agent陪学" : mode}。`,
    `绘本：${trimText(payload.bookTitle, 120) || "未命名绘本"}`,
    `当前页：${trimText(payload.pageLabel, 80) || "当前页"}`,
    `当前目标原文：${getTeachingContextText(payload, 600) || "暂无文字"}`,
    `孩子当前看到的提示：${trimText(payload.visiblePrompt, 600) || "无"}`,
    buildCoachHistoryPrompt(payload),
    buildNavigationPrompt(payload),
    buildUiControlPrompt(payload),
    buildTeachingContextPrompt(payload),
    buildAgentLessonStatePrompt(payload),
    buildCharacterProfilePrompt(payload),
    buildPronunciationTargetPrompt(payload),
    buildCorrectionPacingPrompt(payload),
    bilingualCoachRules,
    "孩子可以问你任何问题，你都可以先正常回答，不要只机械纠错。",
    isAgentMaterial
      ? "这是孩子自己上传的学习资料。不要提“领取提示”“查看原文”等绘本任务控件；要像老师一样围绕当前资料页讲解、总结、提问和答疑。"
      : "如果孩子跑题太久，先接住孩子的问题，再用一句自然的话把孩子带回当前绘本练习。",
    isAgentMaterial
      ? "如果当前页文字上下文不足，就先根据画面中能看到的人物、动作、物品和英文词进行讲解；不要直接说“识别内容不足”。"
      : "每次回答控制在 1 到 3 句。多鼓励，少说教。看图说话时不要一上来直接给完整原文，除非孩子已经显示原文。",
    isAgentMaterial
      ? "如果孩子通过语音或文字要求读原文、读正文、读这一页的句子，这就是明确要求答案；必须按当前目标原文完整朗读，不能只挑最后一句或重点句。"
      : "",
    isAgentMaterial
      ? "严禁使用旧绘本或旧上传资料的内容来补全当前页；当前资料没有出现的词，不要当作本页重点。尤其不要沿用 Spots、Dad had spots 等旧内容。"
      : "",
    isAgentMaterial
      ? "首次进入资料并开启实时语音后，自动进入两轮陪学流程：第一轮AI带读讲解，第二轮学生自主朗读并接受反馈。不要再使用“先听老师读还是你先读”的旧单轮选择流程。"
      : "",
    isAgentMaterial
      ? agentLessonFlowPrompt
      : "",
    "同一个发音细节最多纠正 3 次；到第 3 次后不要再要求孩子重复，给建议和鼓励后继续后面的内容。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildDialogContext = (payload: RealtimeTurnRequest) => {
  const isAgentMaterial =
    /Agent|自学资料|自己上传|上传的学习资料/.test(
      `${payload.bookTitle || ""} ${payload.aiTeachingContext?.instruction || ""}`
    );
  const pronunciationTarget = getPronunciationTarget(payload, 120);
  const targetText = getTeachingContextText(payload, 180) || (isAgentMaterial ? "当前上传资料页" : "当前绘本页");
  const keyWord = targetText.split(/\s+/).find((word) => word.length > 3) || targetText;
  return [
    {
      role: "user",
      text: pronunciationTarget || targetText,
    },
    {
      role: "assistant",
      text: isAgentMaterial
        ? pronunciationTarget
          ? `我会先听你读 ${pronunciationTarget}，然后直接点评发音是否接近。`
          : `我会先陪你看图，再读句子，最后聊一聊故事。你可以选择先听我读，或者你先试着读。`
        : `读得不错！这是英文朗读练习，我会用中文帮你纠音，不会因为你读英文就切成全英文。可以注意 ${keyWord} 这个词的发音和节奏；如果已经练过几次，我们就继续下一句。`,
    },
  ];
};

const openRealtimeTurn = (payload: RealtimeTurnRequest) =>
  new Promise<{ reply: string; audioDataUrl: string; events: number[]; asrText: string }>((resolve, reject) => {
    const endpoint =
      getEnv("VOLCENGINE_URL") ||
      getEnv("DOUBAO_REALTIME_URL") ||
      "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
    const appId = getEnv("DOUBAO_REALTIME_APP_ID") || getEnv("RTC_APP_ID");
    const accessKey =
      getEnv("DOUBAO_REALTIME_ACCESS_TOKEN") ||
      getEnv("RTC_ACCESS_KEY") ||
      getEnv("DOUBAO_API_KEY");
    const apiKey = getEnv("DOUBAO_API_KEY");
    const resourceId =
      getEnv("DOUBAO_REALTIME_RESOURCE_ID") ||
      getEnv("RTC_RESOURCE_ID") ||
      "volc.speech.dialog";
    const appKey =
      getEnv("DOUBAO_REALTIME_APP_KEY") ||
      getEnv("RTC_APP_KEY");
    const audioInput = trimText(payload.audioPcmBase64, 8_000_000);
    const audioBuffer = audioInput ? Buffer.from(audioInput, "base64") : null;
    const inputMod = audioBuffer ? "audio_file" : getEnv("DOUBAO_INPUT_MOD") || "text";
    const hasAppIdAuth = Boolean(appId && accessKey);
    const hasApiKeyAuth = Boolean(apiKey);

    if (!hasAppIdAuth && !hasApiKeyAuth) {
      reject(
        new Error(
          "缺少豆包实时语音鉴权配置：请配置 DOUBAO_API_KEY，或配置 DOUBAO_REALTIME_APP_ID + DOUBAO_REALTIME_ACCESS_TOKEN"
        )
      );
      return;
    }

    const WebSocket = nodeRequire("ws") as new (
      url: string,
      options: { headers: Record<string, string> }
    ) => WsLike;
    const sessionId =
      globalThis.crypto?.randomUUID?.() ||
      `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const connectId =
      globalThis.crypto?.randomUUID?.() ||
      `connect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const authHeaders: Record<string, string> = hasAppIdAuth
      ? {
          "X-Api-App-ID": appId,
          "X-Api-Access-Key": accessKey,
        }
      : {
          "X-Api-Key": apiKey,
        };
    const ws = new WebSocket(endpoint, {
      headers: {
        ...authHeaders,
        "X-Api-Resource-Id": resourceId,
        "X-Api-App-Key": appKey,
        "X-Api-Connect-Id": connectId,
      },
    });

    let reply = "";
    let asrText = "";
    const audioChunks: Buffer[] = [];
    const events: number[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("豆包实时语音响应超时"));
    }, 30000);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      const audio = audioChunks.length ? Buffer.concat(audioChunks) : null;
      resolve({
        reply: reply.trim() || "我在听。先看图说一句，再试一次。",
        audioDataUrl: audio ? `data:audio/ogg;base64,${audio.toString("base64")}` : "",
        events,
        asrText: asrText.trim(),
      });
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      reject(error instanceof Error ? error : new Error("豆包实时语音连接失败"));
    };

    ws.on("open", () => {
      ws.send(buildFullClientPayload(EVENTS.StartConnection, {}));
    });

    ws.on("message", (data: unknown) => {
      const buffer = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[])
            : Buffer.from(String(data));
      const parsed = parseServerPayload(buffer);
      if (!parsed) return;
      events.push(parsed.event);
      if (parsed.error) {
        fail(new Error(parsed.error));
        return;
      }
      if (parsed.event === EVENTS.ConnectionStarted) {
        ws.send(
          buildFullClientPayload(
            EVENTS.StartSession,
            {
              dialog: {
                bot_name: "Mia老师",
                system_role: buildSystemRole(payload),
                speaking_style:
                  "像耐心的少儿英语老师一样说话。中文为主，不因孩子读英文原句就切换成纯英文；英文只用于原句、关键词、发音示范。短句，先鼓励再提示；同一个发音点最多纠正三次，之后鼓励并继续。",
                dialog_id: "",
                dialog_context: buildDialogContext(payload),
                extra: {
                  input_mod: inputMod,
                  model: "1.2.1.1",
                  strict_audit: true,
                },
              },
              tts: {
                speaker: getTtsSpeaker(payload),
              },
              ...(audioBuffer
                ? {
                    asr: {
                      audio_info: {
                        format: "pcm_s16le",
                        sample_rate: 16000,
                        channel: 1,
                      },
                    },
                  }
                : {}),
            },
            sessionId
          )
        );
        return;
      }
      if (parsed.event === EVENTS.SessionStarted) {
        if (audioBuffer) {
          void (async () => {
            const chunkSize = 3200;
            for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
              if (settled) return;
              ws.send(
                buildAudioClientPayload(
                  EVENTS.TaskRequest,
                  audioBuffer.subarray(offset, offset + chunkSize),
                  sessionId
                )
              );
              await new Promise((resolveChunk) => setTimeout(resolveChunk, 5));
            }
            if (!settled) {
              ws.send(buildFullClientPayload(EVENTS.EndASR, {}, sessionId));
            }
          })();
          return;
        }
        const ttsText = trimText(payload.ttsText, 1200);
        const studentContent =
          ttsText ||
          trimText(payload.message, 600) ||
          trimText(payload.studentMessage, 600) ||
          "我刚刚发了一段语音，请根据当前绘本页给我一个鼓励和下一步提示。";
        const pronunciationTarget = getPronunciationTarget(payload, 120);
        ws.send(
          buildFullClientPayload(
            EVENTS.ChatTextQuery,
            {
              content: ttsText
                ? `请原样播报下面这段文字，不要增删或解释：\n${ttsText}`
                : [
                    `孩子刚刚说：${studentContent}`,
                    pronunciationTarget
                      ? `本轮朗读目标：${pronunciationTarget}。请先判断孩子读得是否接近，不要重新解释词义。`
                      : "",
                    "请把这句话优先当作绘本练习输入处理，尤其是英文句子不要当成英文闲聊。",
                    "请用中文主导回复：中文鼓励 + 一个朗读/表达建议 + 必要英文关键词或短句示范；除非孩子明确要求全英文，否则不要纯英文回答。",
                    "如果要纠音，只挑一个最重要的问题；同一个发音点最多纠正三次，之后给建议和鼓励并继续后面的练习。",
                  ]
                    .filter(Boolean)
                    .join("\n"),
            },
            sessionId
          )
        );
        return;
      }
      if (parsed.event === EVENTS.ASRResponse && parsed.payload && typeof parsed.payload === "object") {
        const results = (parsed.payload as { results?: Array<{ text?: unknown; is_interim?: unknown }> }).results;
        const finalText =
          Array.isArray(results)
            ? results
                .filter((item) => item && item.is_interim === false && typeof item.text === "string")
                .map((item) => item.text)
                .join(" ")
                .trim()
            : "";
        if (finalText) asrText = finalText;
        return;
      }
      if (parsed.event === EVENTS.ASREnded) {
        return;
      }
      if (parsed.event === EVENTS.ChatResponse && parsed.payload && typeof parsed.payload === "object") {
        const content = (parsed.payload as { content?: unknown }).content;
        if (typeof content === "string") reply += content;
        return;
      }
      if (parsed.event === EVENTS.TTSResponse && parsed.audio?.length) {
        audioChunks.push(parsed.audio);
        return;
      }
      if (parsed.event === EVENTS.ChatEnded) {
        return;
      }
      if (parsed.event === EVENTS.TTSEnded) {
        ws.send(buildFullClientPayload(EVENTS.FinishSession, {}, sessionId));
        ws.send(buildFullClientPayload(EVENTS.FinishConnection, {}));
        finish();
      }
    });

    ws.on("error", fail);
    ws.on("close", () => {
      if (!settled && reply) finish();
    });
  });

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RealtimeTurnRequest;
    const result = await openRealtimeTurn(payload);
    return NextResponse.json({ provider: "doubao-realtime", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "豆包实时语音连接失败",
      },
      { status: 500 }
    );
  }
}
