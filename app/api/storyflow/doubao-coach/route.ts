import { NextResponse } from "next/server";
import { requestVisionChatCompletion } from "@/lib/storyflowVisionClient";
import { agentLessonFlowPrompt } from "@/lib/agentLessonFlow";

export const runtime = "nodejs";

type CoachMode = "shadow" | "speaking";

type CoachRequest = {
  mode?: CoachMode;
  studentMessage?: string;
  bookTitle?: string;
  pageLabel?: string;
  pageText?: string;
  visiblePrompt?: string;
  hintStage?: number;
  screenshotDataUrl?: string;
  textFocusImageDataUrl?: string;
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

const trimText = (value: unknown, maxLength = 1200) => {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trim();
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

const getTeachingContextText = (payload: CoachRequest, maxLength = 900) =>
  sanitizeTeachingText(
    payload.aiTeachingContext?.currentPageText || payload.pageText,
    payload.bookTitle,
    maxLength
  );

const buildCoachHistoryPrompt = (payload: CoachRequest) => {
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

const buildCorrectionPacingPrompt = (payload: CoachRequest) => {
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

const getPronunciationTarget = (payload: CoachRequest, maxLength = 120) =>
  trimText(payload.aiTeachingContext?.pronunciationTarget || payload.pronunciationTarget, maxLength);

const isImageDescriptionMessage = (value: unknown) =>
  /封面|画面|图片|图里|看图|看到|有什么|描述|讲讲.*图|介绍.*图|人物|发生|画了什么/.test(
    trimText(value, 260)
  );

const hasImageContext = (payload: CoachRequest) =>
  trimText(payload.screenshotDataUrl, 40).startsWith("data:image/") ||
  trimText(payload.textFocusImageDataUrl, 40).startsWith("data:image/");

const isVisualFactRequest = (payload: CoachRequest) =>
  hasImageContext(payload) &&
  !/点击翻页|已经翻到|翻到.+页|开始讲解这一页|开始第二轮学习/.test(
    trimText(payload.studentMessage, 360)
  ) &&
  (isImageDescriptionMessage(payload.studentMessage) ||
    /视觉事实问答模式|视觉事实/.test(trimText(payload.aiTeachingContext?.instruction, 360)));

const getReplyLanguagePreference = (payload: CoachRequest) => {
  const text = [
    payload.studentMessage,
    payload.aiTeachingContext?.instruction,
  ]
    .map((item) => trimText(item, 360))
    .filter(Boolean)
    .join(" ");

  if (
    /(?:用|说|讲|回答|描述|介绍).{0,12}(?:英语|英文)|(?:英语|英文).{0,12}(?:回答|描述|介绍|说|讲)|\bin english\b|\benglish only\b|\bspeak english\b|\buse english\b/i.test(
      text
    )
  ) {
    return "english" as const;
  }
  if (
    /(?:用|说|讲|回答|描述|介绍).{0,12}中文|中文.{0,12}(?:回答|描述|介绍|说|讲)|\bin chinese\b|\bchinese only\b/i.test(
      text
    )
  ) {
    return "chinese" as const;
  }
  return "default" as const;
};

const buildLanguageInstruction = (payload: CoachRequest) => {
  const preference = getReplyLanguagePreference(payload);
  if (preference === "english") {
    return {
      preference,
      system: "The child explicitly asked for English. Answer entirely in natural, child-friendly English. Do not add Chinese translations unless the child asks.",
      user: "Please answer in English only, 2 to 4 short sentences, accurate and restrained. Do not write Chinese.",
    };
  }
  if (preference === "chinese") {
    return {
      preference,
      system: "孩子明确要求中文回答。请用中文回答。",
      user: "请用中文回答，2 到 4 句，准确、克制、不要编故事。",
    };
  }
  return {
    preference,
    system: "默认用中文回答，准确、简短、克制。",
    user: "请用中文回答，2 到 4 句，准确、克制、不要编故事。",
  };
};

const isAgentMaterialRequest = (payload: CoachRequest) =>
  /Agent|自学资料|自己上传|上传的学习资料/.test(
    `${payload.bookTitle || ""} ${payload.aiTeachingContext?.instruction || ""}`
  );

const buildPronunciationTargetPrompt = (payload: CoachRequest) => {
  const target = getPronunciationTarget(payload);
  if (!target) return "";
  return [
    "【本轮朗读目标】",
    `孩子这一轮是在朗读：${target}`,
    "必须先回应这次朗读是否接近目标词/句，再给 1 个最重要的发音建议。",
    "不要把这轮当成普通问答，也不要重新解释这个词的意思，除非孩子明确问意思。",
  ].join("\n");
};

const buildNavigationPrompt = (payload: CoachRequest) => {
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

const buildUiControlPrompt = (payload: CoachRequest) => {
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

const buildTeachingContextPrompt = (payload: CoachRequest) => {
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
    allPageTexts ? `全书页码原文索引：${trimText(allPageTexts, 1300)}` : "",
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

const buildCharacterProfilePrompt = (payload: CoachRequest) => {
  const profile = trimText(payload.aiTeachingContext?.characterProfile, 1800);
  if (!profile) return "";
  return [
    "【人物识别参考】",
    profile,
    "使用人物卡时必须谨慎：只有画面特征或页面文字支持时才使用角色名；不确定时说“可能是”，不要把参考资料当成画面事实。",
  ].join("\n");
};

const buildAgentLessonStatePrompt = (payload: CoachRequest) => {
  const state = trimText(payload.aiTeachingContext?.lessonState, 900);
  return state ? `${state}\n请优先遵循这个当前步骤，不要跳到后续步骤。` : "";
};

const getEnv = (name: string) => process.env[name]?.trim() || "";

const getDoubaoEndpoint = () => {
  const baseUrl =
    getEnv("DOUBAO_TEXT_IMAGE_BASE_URL") ||
    getEnv("DOUBAO_CHAT_BASE_URL") ||
    getEnv("DOUBAO_BASE_URL") ||
    "https://ark.cn-beijing.volces.com/api/v3";
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
};

const getDoubaoModel = () =>
  getEnv("DOUBAO_TEXT_IMAGE_MODEL") ||
  getEnv("DOUBAO_VISION_MODEL") ||
  getEnv("DOUBAO_MODEL") ||
  "doubao-1-5-lite-32k-250115";

const getExplicitDoubaoVisionModel = () =>
  getEnv("DOUBAO_TEXT_IMAGE_MODEL") || getEnv("DOUBAO_VISION_MODEL");

const getDoubaoApiKey = () =>
  getEnv("DOUBAO_TEXT_IMAGE_API_KEY") ||
  getEnv("DOUBAO_API_KEY") ||
  getEnv("RTC_ACCESS_KEY");

const getExplicitDoubaoVisionApiKey = () =>
  getEnv("DOUBAO_TEXT_IMAGE_API_KEY") || getEnv("DOUBAO_API_KEY") || getEnv("RTC_ACCESS_KEY");

const getFallbackEndpoint = () => {
  const baseUrl = getEnv("LLM_BASE_URL");
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
};

const buildCoachSystemPrompt = (mode: CoachMode) => `
你是一个真人感很强、温柔、活泼的儿童英语绘本 AI 语音教练。
你的任务是在学生练习${mode === "shadow" ? "影子跟读" : "看图说话"}时进行实时陪伴。

规则：
1. 孩子可以问你任何问题，你都可以先自然回答，不要只机械纠错。
2. 如果孩子跑题太久，先接住孩子的问题，再用一句自然的话带回当前绘本练习。
3. 回复适合孩子听，通常 1 到 3 句，多鼓励，少说教。
4. 如果孩子在看图说话且还没有要求答案，不要直接整句给出原文；用关键词、首字母、角色动作来提示。
5. 如果孩子在影子跟读，可以指出一个最需要改的词、节奏或重音。
6. 你始终保持“中文主导 + 必要英文示范”的双语老师状态。
7. 英文朗读输入不是英文聊天。孩子说英文时，优先判断为正在读绘本原句、练习英文表达或询问某个英文词，不要因此切换成纯英文回复。
8. 如果孩子读的是当前目标原文或相近句子，必须像老师点评朗读：先用中文鼓励，再用中文指出一个发音、重音或节奏点，只引用必要的英文词或短句示范，最后用中文引导继续。
9. 如果孩子用中文提问，就用中文回答；如果孩子中英文混说，也保持中文解释 + 少量英文关键词。
10. 只有孩子明确说“用英语/英文回答/描述”“请全英文回答”“English only”“speak only English”“in English”时，才可以全英文。
	11. 如果截图或页面上下文不足，就根据提供的文字上下文回答，不要编造绘本内容。
	11a. 孩子问“封面/画面/图片/图里有什么/看到了什么”时，只能描述当前图片中明确可见的元素；不能根据书名、故事主题或常识推测。看不清就说看不清。严禁编造“打开了、发光、宝物、人物动作”等图片里没有明确出现的细节。
	12. 同一个发音细节最多纠正 3 次；到第 3 次后不要再要求孩子重复，给建议和鼓励后继续后面的内容。
	13. 在绘本学习里，“正文”“原文”“图片下面的文字”通常指插图下方的大段英文句子，不是插图里的公告牌、海报、标题、标签或环境文字。孩子问正文时，优先读取页面下方正文区域。
	14. Agent资料进入实时语音后，要遵循两轮陪学流程：第一轮AI带读讲解，第二轮学生自主朗读并接受反馈。不要再使用“先听老师读还是你先读”的旧单轮选择流程。
	15. 第一轮每页先看图，再读原文，再解释重点句子和重点单词；第二轮每页听学生朗读后，按“先鼓励、再纠正、再示范、再练习”反馈。
	`;

const buildVisualFactSystemPrompt = (payload?: CoachRequest) => `
你是儿童绘本图片事实描述助手。
你只能根据用户消息里附带的图片描述当前画面，不能根据标题、故事主题、常识或上下文猜测。
如果图片中没有明确显示某个细节，必须说不能确定，不能补充想象。
不要编故事，不要猜隐藏内容，不要问孩子猜宝箱里有什么。
${payload ? buildLanguageInstruction(payload).system : "默认用中文回答，准确、简短、克制。"}
`;

const buildCoachUserPrompt = (payload: CoachRequest) => {
  const mode = payload.mode === "shadow" ? "shadow" : "speaking";
  const hintStage = Number.isFinite(payload.hintStage) ? Number(payload.hintStage) : 0;
  const isAgentMaterial = isAgentMaterialRequest(payload);
  if (isVisualFactRequest(payload)) {
    const languageInstruction = buildLanguageInstruction(payload);
    return [
      "【视觉事实问答】",
      "孩子正在问当前图片/封面里画了什么。你必须只根据随本消息发送的图片回答。",
      "请描述图片中明确可见的元素、位置和关系，不要根据书名、故事主题、常识或对话历史推测。",
      "禁止说图片里没有明确出现的内容。尤其：没有明确看到宝箱打开、金光、里面的宝物，就不能说宝箱打开、有金光、里面藏着宝物。",
      "不要问孩子“你觉得里面有什么”，不要引导猜隐藏内容；本轮只做事实描述。",
      "如果看不清某个细节，就说“这个细节看不清/不能确定”。",
      buildCharacterProfilePrompt(payload),
      `孩子刚刚问：${trimText(payload.studentMessage, 300) || "请描述当前图片"}`,
      languageInstruction.user,
    ].join("\n");
  }
  return [
    `任务模式：${mode === "shadow" ? "影子跟读" : "看图说话"}`,
    `绘本：${trimText(payload.bookTitle, 120) || "未命名绘本"}`,
    `当前页：${trimText(payload.pageLabel, 80) || "当前页"}`,
    `当前原文/目标句：${getTeachingContextText(payload, 900) || "暂无文字"}`,
    buildCoachHistoryPrompt(payload),
    buildNavigationPrompt(payload),
    buildUiControlPrompt(payload),
    buildTeachingContextPrompt(payload),
    buildAgentLessonStatePrompt(payload),
    buildCharacterProfilePrompt(payload),
    buildPronunciationTargetPrompt(payload),
    buildCorrectionPacingPrompt(payload),
    `当前已显示给孩子的提示：${trimText(payload.visiblePrompt, 900) || "无"}`,
    `提示阶段：${hintStage === 0 ? "只看图片" : hintStage === 1 ? "已领取提示" : "已显示原文"}`,
    `孩子刚刚说/输入：${trimText(payload.studentMessage, 800) || "请主动引导孩子开始练习"}`,
    isAgentMaterial
      ? [
          "Agent资料规则：这是孩子自己上传的学习资料。严禁使用旧绘本或旧上传资料内容来补全当前页；当前资料没有出现的词，不要当作本页重点。尤其不要沿用 Spots、Dad had spots 等旧内容。",
          agentLessonFlowPrompt,
        ].join("\n")
      : "",
    "正文定位：如果孩子说“正文/原文/图片下面的文字/读一下这一页”，请优先读取绘本插图下方的大段英文句子。不要把画面中公告栏、海报、牌子、标题里的小字当作正文。",
    "请给孩子自然语音回复，通常 1 到 3 句；如果孩子说的是英文句子，请当作朗读练习点评，不要切成纯英文回答；如果需要纠错，只挑一个最重要的问题，且不要反复卡同一个细节。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildMessageContent = (payload: CoachRequest) => {
  const text = buildCoachUserPrompt(payload);
  const screenshot = trimText(payload.screenshotDataUrl, 3_800_000);
  const textFocusImage = trimText(payload.textFocusImageDataUrl, 3_800_000);
  if (!screenshot.startsWith("data:image/") && !textFocusImage.startsWith("data:image/")) {
    return text;
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
	    {
	      type: "text",
	      text: [
	        text,
	        "【图片阅读说明】",
	        "第一张图是学生当前正在看的 Agent 学习屏幕实时截图，包含当前可见资料页、页码、右侧对话状态和按钮。回答前必须先看第一张图，按第一张图里的当前画面回答，不要使用旧页面或旧资料。",
		        "如果有第二张图，第二张图是当前资料页的完整高清补充图，可能是单页，也可能是左右双页。孩子问正文、原文、图片下面文字时，请按第二张图从上到下、从左到右读取大段英文正文；孩子问封面/画面/图片内容时，请优先描述第一张图和第二张图中当前可见资料页的真实画面。",
            "视觉事实规则：只能说图片里确实看得见的内容；不要因为标题或故事主题推测看不见的内容。比如没有明确看到宝箱打开、金光、宝物，就不能说宝箱打开、发光或里面有宝物。",
		        "如果后台原文已经提供，请优先按后台原文完整朗读；第二张图用于校验和补充。无论使用后台原文还是图片识别，都不能漏掉正文第一句或第一行。双页展开时必须先读完左页全部正文，再读右页全部正文，不能横向跨页拼接。",
	      ].join("\n"),
	    },
  ];

  if (screenshot.startsWith("data:image/")) {
    content.push({
      type: "image_url",
      image_url: {
        url: screenshot,
      },
    });
  }

  if (textFocusImage.startsWith("data:image/")) {
    content.push(
      {
        type: "text",
	        text: "第二张图：当前资料页完整高清图。请按页面真实阅读顺序读取大段英文句子，尤其不要漏掉正文第一行。双页展开时先完整读左页，再完整读右页，不要跨中缝横向拼接两页的行。",
      },
      {
        type: "image_url",
        image_url: {
          url: textFocusImage,
        },
      }
    );
  }

  return content;
};

const buildLocalCoachReply = (payload: CoachRequest) => {
  const mode = payload.mode === "shadow" ? "shadow" : "speaking";
  const rawPageText = getTeachingContextText(payload, 260);
  const normalizedRawPageText = rawPageText.replace(/\s+/g, " ").trim();
  const isFileReferenceText =
    /\.(pdf|docx?|jpe?g|png|webp)$/i.test(normalizedRawPageText) ||
    (normalizedRawPageText &&
      trimText(payload.bookTitle, 260).replace(/\s+/g, " ").trim() === normalizedRawPageText);
  const pageText =
    /^\d{1,4}$/.test(rawPageText.replace(/\s+/g, "")) || isFileReferenceText
      ? ""
      : rawPageText;
  const message = trimText(payload.studentMessage, 120);
  const isPageTurnLecture =
    /点击翻页|已经翻到|翻到.+页|开始讲解这一页|开始第二轮学习/.test(message);
  const wantsImageDescription = /封面|画面|图片|图里|看图|看到|有什么|描述|人物|发生/.test(message);
  const pronunciationTarget = getPronunciationTarget(payload, 120);
  const hasImageContext =
    trimText(payload.screenshotDataUrl, 40).startsWith("data:image/") ||
    trimText(payload.textFocusImageDataUrl, 40).startsWith("data:image/");
  if (pronunciationTarget) {
    return `我听到你在练 ${pronunciationTarget}。这轮我们先不讲意思，先看发音：把主要音节读清楚就很棒；再来一遍时，注意开头音和结尾音。`;
  }
  if (mode === "shadow") {
    if (pageText) {
      return `我听到了。先跟着这一句慢慢读：${pageText}。注意把最后一个词读清楚。`;
    }
    return "我听到了。先看图片，慢一点读，读完后再按一次录音。";
  }
  if (/我先.*读|我来.*读|我.*试着读|自己.*读|先试着读/.test(message)) {
    return "好，那你先试着读这一页，我来认真听。读错没关系，我只帮你找一个最值得练的地方。";
  }
  if (isPageTurnLecture && pageText) {
    return `我们翻到${trimText(payload.pageLabel, 80) || "这一页"}了。我先带你学这一页：${pageText}。先听我读一遍，再找一个你觉得重要的词。`;
  }
  if (isPageTurnLecture) {
    return `我们翻到${trimText(payload.pageLabel, 80) || "这一页"}了。我先带你看这一页：先观察画面里的主要人物、地点和动作。你可以先告诉我，你第一眼看到了什么？`;
  }
  if (hasImageContext && wantsImageDescription) {
    return "我现在没有拿到可靠的视觉识别结果，不能乱编画面内容。请你先说一个你能看到的东西，我再根据你说的继续引导。";
  }
  if (pageText && /老师先读|先听.*读|示范读|带我读/.test(message)) {
    return `好，我先示范读一遍，你只要跟着感觉节奏就可以：${pageText}`;
  }
  if (pageText && /读|朗读|读一遍|句子|原文|正文/.test(message)) {
    return `这一页的句子是：${pageText} 我先读一遍：${pageText}`;
  }
  if (pageText && /重点|主要|讲什么|学什么|总结/.test(message)) {
    return `这一页的重点是理解这段内容：“${pageText}”。你可以先找关键词，再用一句自己的话说出它在讲什么。`;
  }
  if (pageText && /单词|英文|词汇|意思/.test(message)) {
    return `这一页可以从这些内容里找关键词：${pageText}。你可以指出一个不会的英文词，我会讲意思、读音和例句。`;
  }
  if (pageText && /三个问题|提问|问我/.test(message)) {
    return "可以，我根据这一页问你三个问题：1. 这一页主要讲了什么？2. 你能找出一个关键词吗？3. 你能用自己的话复述这页内容吗？";
  }
  if (pageText && /老师|讲给我|解释|不会|不懂/.test(message)) {
    return `我像老师一样讲这一页：这页的核心内容是“${pageText}”。你先不用背，先理解它在讲什么；然后试着用自己的话说一句。`;
  }
  if (pageText) {
    return `我根据当前页先带你学：${pageText}。你可以继续问我重点、单词，或者让我像老师一样讲一遍。`;
  }
  if (hasImageContext && /正文|原文|图片下面|下面的文字|读一下|朗读|读一读|老师|讲|解释|重点|总结|难点|单词/.test(message)) {
    return "当前视觉识别还没有接管，我现在不能可靠读取图片下面的正文。你可以把这页文字发给我，我会马上像老师一样讲给你听。";
  }
  if (message.includes("语音") || message.includes("练习")) {
    return "很好，我在听。你可以先说画面里有什么，或者直接问我这一页哪里不会。";
  }
  if (/老师|讲|解释|重点|总结|难点|单词/.test(message)) {
    return "我现在还没有读到图片下面的正文。你可以把这页文字发给我，我会马上像老师一样具体讲解。";
  }
  return "我现在还没有读到这页的文字。你可以把问题里的文字发给我，我会马上帮你讲。";
};

const extractAssistantText = (value: unknown) => {
  const response = value as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { text?: unknown; content?: unknown };
      return typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
};

const requestChatCompletion = async (
  endpoint: string,
  apiKey: string,
  model: string,
  payload: CoachRequest
) => {
  const mode: CoachMode = payload.mode === "shadow" ? "shadow" : "speaking";
  const visualFactRequest = isVisualFactRequest(payload);
  const body = {
    model,
    temperature: visualFactRequest ? 0.05 : 0.55,
    max_tokens: visualFactRequest ? 180 : 220,
    messages: [
      {
        role: "system",
        content: visualFactRequest
          ? buildVisualFactSystemPrompt(payload)
          : buildCoachSystemPrompt(mode),
      },
      {
        role: "user",
        content: buildMessageContent({ ...payload, mode }),
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(getEnv("DOUBAO_USE_X_API_KEY") === "true" ? { "X-Api-Key": apiKey } : {}),
    },
    body: JSON.stringify(body),
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
        "AI coach request failed"
    );
  }

  return extractAssistantText(parsed);
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CoachRequest;
    const visualFactRequest = isVisualFactRequest(payload);
    if (visualFactRequest) {
      try {
        const images = [
          trimText(payload.screenshotDataUrl, 3_800_000),
          trimText(payload.textFocusImageDataUrl, 3_800_000),
        ].filter((item) => item.startsWith("data:image/"));
        const response = await requestVisionChatCompletion({
          systemPrompt: buildVisualFactSystemPrompt(payload),
          userText: [
            buildCoachUserPrompt(payload),
            "必须只根据本轮附带图片回答。不要使用书名、上下文或常识补全看不见的细节。",
          ].join("\n"),
          images,
          temperature: 0.05,
          maxTokens: 220,
        });
        return NextResponse.json({
          provider: response.provider,
          model: response.model,
          reply: response.text,
        });
      } catch (visionError) {
        return NextResponse.json({
          provider: "vision-unavailable",
          visionError:
            visionError instanceof Error ? visionError.message : "vision request failed",
          reply: buildLocalCoachReply(payload),
        });
      }
    }

    const explicitVisionModel = getExplicitDoubaoVisionModel();
    const apiKey = visualFactRequest ? getExplicitDoubaoVisionApiKey() : getDoubaoApiKey();
    let doubaoError = "";

    if (apiKey && (!visualFactRequest || explicitVisionModel)) {
      try {
        const reply = await requestChatCompletion(
          getDoubaoEndpoint(),
          apiKey,
          visualFactRequest ? explicitVisionModel : getDoubaoModel(),
          payload
        );
        return NextResponse.json({
          provider: "doubao",
          reply: reply || "我在看这一页。先试着说出主角，再说发生了什么。",
        });
      } catch (error) {
        doubaoError = error instanceof Error ? error.message : "Doubao request failed";
      }
    } else if (visualFactRequest && !explicitVisionModel) {
      doubaoError =
        "视觉事实请求已跳过豆包普通文本模型：请配置 DOUBAO_TEXT_IMAGE_MODEL 或 DOUBAO_VISION_MODEL";
    } else {
      doubaoError =
        "DOUBAO_TEXT_IMAGE_API_KEY / DOUBAO_API_KEY is not configured on server";
    }

    const fallbackEndpoint = getFallbackEndpoint();
    const fallbackKey = getEnv("LLM_API_KEY");
    const fallbackModel = getEnv("LLM_MODEL");
    if (fallbackEndpoint && fallbackKey && fallbackModel) {
      try {
        const reply = await requestChatCompletion(
          fallbackEndpoint,
          fallbackKey,
          fallbackModel,
          payload
        );
        return NextResponse.json({
          provider: "llm-fallback",
          doubaoError,
          reply: reply || "我在看这一页。先试着说出主角，再说发生了什么。",
        });
      } catch (fallbackError) {
        return NextResponse.json({
          provider: "local-fallback",
          doubaoError,
          fallbackError:
            fallbackError instanceof Error ? fallbackError.message : "fallback request failed",
          reply: buildLocalCoachReply(payload),
        });
      }
    }

    return NextResponse.json({
      provider: "local-fallback",
      doubaoError,
      reply: buildLocalCoachReply(payload),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Doubao coach request failed",
      },
      { status: 500 }
    );
  }
}
