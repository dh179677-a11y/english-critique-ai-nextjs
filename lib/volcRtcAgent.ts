import { createHash, createHmac } from "node:crypto";
import { formatStoryCharacterProfileForPrompt } from "@/lib/storyCharacterProfiles";
import { agentLessonFlowPrompt } from "@/lib/agentLessonFlow";

export type RtcAgentSession = {
  appId: string;
  roomId: string;
  userId: string;
  agentUserId: string;
  taskId: string;
  token: string;
};

export type RtcAgentStartRequest = RtcAgentSession & {
  lessonState?: string;
  welcomeMessage?: string;
};

type VoiceChatConfig = {
  appId: string;
  appKey: string;
  botId: string;
  ak: string;
  sk: string;
  modelName: string;
  ttsSpeaker: string;
  ttsSpeechRate: number;
  ttsLoudnessRate: number;
  ttsPitch: number;
  welcomeMessage: string;
};

const getEnv = (name: string) => process.env[name]?.trim() || "";

const getNumberEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(getEnv(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const agentWelcomeMessages = [
  "你好呀，我看到你上传了新的英语学习资料。今天我们一起慢慢读，读错了也没关系。",
  "准备好了吗？今天我们要开启一场英语闯关，每一页都是一个小关卡。",
  "哇，我看到今天的内容里有一些有趣的图片和句子。我们来看看故事发生了什么吧。",
  "嗨，今天我会像你的英语小伙伴一样陪你学习。你只要大胆开口就很好。",
  "你已经把学习资料准备好了，这一步非常棒。接下来我们一起完成今天的英语阅读任务。",
  "你好呀，今天我们不赶时间。我们一页一页来，慢慢读懂就很棒。",
  "太好了，资料已经准备好了。我们先像侦探一样看图片，再像小演员一样读句子。",
  "欢迎回来，今天我们一起读一个新的内容。我会陪你发现重点和进步。",
];

const agentLessonIntroMessages = [
  "我们今天分两遍学习。第一遍，我来读给你听，帮你讲懂重点单词和句子。第二遍，你来读，我会帮你纠正发音，还会问你几个小问题。现在先看封面：你看到了什么？",
  "第一遍老师读，你来听；第二遍你来读，老师帮你把发音和理解变得更棒。我们先看封面：请告诉我你看到的东西。",
  "接下来我们学两轮：先由我带你读懂，再请你自己读一遍。我会帮你练发音，也会问你小问题。现在看封面，你觉得这个故事可能讲什么？",
  "我们先听老师读一遍，弄懂图片、单词和句子；然后你来挑战朗读，我来给你小建议。现在先看封面，找一找画面里最明显的东西。",
];

const pickAgentWelcomeMessage = () =>
  [
    agentWelcomeMessages[Math.floor(Math.random() * agentWelcomeMessages.length)] ||
      agentWelcomeMessages[0],
    agentLessonIntroMessages[Math.floor(Math.random() * agentLessonIntroMessages.length)] ||
      agentLessonIntroMessages[0],
  ].join(" ");

const RTC_TOKEN_VERSION = "001";

const rtcPrivileges = {
  publishStream: 0,
  publishAudioStream: 1,
  publishVideoStream: 2,
  publishDataStream: 3,
  subscribeStream: 4,
} as const;

class RtcTokenBuffer {
  private buffer = Buffer.alloc(1024);
  private position = 0;

  private ensureCapacity(size: number) {
    if (this.position + size <= this.buffer.length) return;
    const next = Buffer.alloc(Math.max(this.buffer.length * 2, this.position + size));
    this.buffer.copy(next, 0, 0, this.position);
    this.buffer = next;
  }

  putUint16(value: number) {
    this.ensureCapacity(2);
    this.buffer.writeUInt16LE(value, this.position);
    this.position += 2;
    return this;
  }

  putUint32(value: number) {
    this.ensureCapacity(4);
    this.buffer.writeUInt32LE(value, this.position);
    this.position += 4;
    return this;
  }

  putBytes(bytes: Buffer) {
    this.putUint16(bytes.length);
    this.ensureCapacity(bytes.length);
    bytes.copy(this.buffer, this.position);
    this.position += bytes.length;
    return this;
  }

  putString(value: string) {
    return this.putBytes(Buffer.from(value, "utf8"));
  }

  putPrivilegeMap(privileges: Record<number, number>) {
    const entries = Object.entries(privileges).sort(([left], [right]) => Number(left) - Number(right));
    this.putUint16(entries.length);
    for (const [key, value] of entries) {
      this.putUint16(Number(key));
      this.putUint32(value);
    }
    return this;
  }

  pack() {
    return this.buffer.subarray(0, this.position);
  }
}

const assertSafeId = (name: string, value: string) => {
  if (!/^[a-zA-Z0-9_@.-]{1,128}$/.test(value)) {
    throw new Error(`${name} 只能包含字母、数字、_、@、-、.，长度 1-128`);
  }
};

const createRtcToken = ({
  appId,
  appKey,
  roomId,
  userId,
  ttlSeconds = 60 * 60 * 24,
}: {
  appId: string;
  appKey: string;
  roomId: string;
  userId: string;
  ttlSeconds?: number;
}) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expireAt = nowSeconds + ttlSeconds;
  const privileges: Record<number, number> = {
    [rtcPrivileges.publishStream]: expireAt,
    [rtcPrivileges.publishAudioStream]: expireAt,
    [rtcPrivileges.publishVideoStream]: expireAt,
    [rtcPrivileges.publishDataStream]: expireAt,
    [rtcPrivileges.subscribeStream]: expireAt,
  };
  const message = new RtcTokenBuffer()
    .putUint32(Math.floor(Math.random() * 0xffffffff))
    .putUint32(nowSeconds)
    .putUint32(expireAt)
    .putString(roomId)
    .putString(userId)
    .putPrivilegeMap(privileges)
    .pack();
  const signature = createHmac("sha256", appKey).update(message).digest();
  const content = new RtcTokenBuffer().putBytes(message).putBytes(signature).pack();

  return `${RTC_TOKEN_VERSION}${appId}${content.toString("base64")}`;
};

export const getRtcAgentConfig = (): VoiceChatConfig => {
  const appId = getEnv("RTC_APP_ID") || getEnv("DOUBAO_REALTIME_APP_ID");
  const appKey = getEnv("RTC_APP_KEY") || getEnv("DOUBAO_REALTIME_APP_KEY");
  const botId = getEnv("DOUBAO_AGENT_BOT_ID") || getEnv("RTC_AGENT_BOT_ID");
  const ak = getEnv("VOLC_ACCESS_KEY_ID") || getEnv("VOLC_ACCESSKEY");
  const sk = getEnv("VOLC_SECRET_ACCESS_KEY") || getEnv("VOLC_SECRETKEY");
  const missing = [
    ["RTC_APP_ID", appId],
    ["RTC_APP_KEY", appKey],
    ["DOUBAO_AGENT_BOT_ID", botId],
    ["VOLC_ACCESS_KEY_ID", ak],
    ["VOLC_SECRET_ACCESS_KEY", sk],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`缺少 RTC 智能体配置：${missing.join(", ")}`);
  }
  if (appKey === sk) {
    throw new Error("RTC_APP_KEY 不能使用 VOLC_SECRET_ACCESS_KEY，请填写 AI音视频互动方案应用管理里的 AppKey");
  }

  return {
    appId,
    appKey,
    botId,
    ak,
    sk,
    modelName: getEnv("DOUBAO_AGENT_MODEL") || "doubao-seed-2-0-lite-260215",
    ttsSpeaker: getEnv("DOUBAO_AGENT_TTS_SPEAKER") || "zh_female_yingyujiaoyu_mars_bigtts",
    ttsSpeechRate: getNumberEnv("DOUBAO_AGENT_TTS_SPEECH_RATE", -4, -50, 50),
    ttsLoudnessRate: getNumberEnv("DOUBAO_AGENT_TTS_LOUDNESS_RATE", 0, -50, 50),
    ttsPitch: getNumberEnv("DOUBAO_AGENT_TTS_PITCH", -2, -12, 12),
    welcomeMessage: getEnv("DOUBAO_AGENT_WELCOME_MESSAGE") || pickAgentWelcomeMessage(),
  };
};

export const createRtcAgentSession = (): RtcAgentSession => {
  const config = getRtcAgentConfig();
  const now = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  const roomId = getEnv("RTC_TEMP_ROOM_ID") || `agent_room_${now}_${suffix}`;
  const userId = getEnv("RTC_TEMP_USER_ID") || `student_${now}_${suffix}`;
  const taskId = `agent_task_${now}_${suffix}`;
  const agentUserId = `mia_${now}_${suffix}`;
  const token =
    getEnv("RTC_TEMP_TOKEN") ||
    createRtcToken({
      appId: config.appId,
      appKey: config.appKey,
      roomId,
      userId,
    });

  assertSafeId("RoomId", roomId);
  assertSafeId("UserId", userId);
  assertSafeId("TaskId", taskId);
  assertSafeId("AgentUserId", agentUserId);

  return {
    appId: config.appId,
    roomId,
    userId,
    agentUserId,
    taskId,
    token,
  };
};

const buildSystemPrompt = (lessonState = "") =>
  [
    "##人设",
    "你是一个英语老师，擅长牛津树、Raz、绘本、以及中小学英语有关知识导师，通过丰富、有趣的方式帮助孩子们学习绘本，特别擅长将复杂的知识以简单易懂、生动有趣的方式呈现给儿童，激发儿童的好奇心和探索欲。",
    "",
    "##技能",
    "你具备英语、心理学、教育学、语言表达以及创意设计等多方面的专业技能，能够根据儿童的年龄特点和兴趣爱好，设计出符合3-12岁儿童认知水平的内容和表达方式。",
    "你可以将复杂知识拆解为简单易懂的小知识点，设计生动有趣的故事、游戏或实验活动来呈现给儿童。",
    "",
    "##约束",
    "回答内容需确保科学准确、健康有益。",
    "语言表达简洁明了、生动有趣，避免使用过于复杂或专业的术语；解释和反馈尽量不超过100个字，但朗读当前页原文不受100字限制，必须读完整。",
    "要注重儿童的参与感和互动性。",
    "开场话术要自然、有随机变化，不要每次固定说同一句。不要再说“你的小脑袋里又有什么问题啦”。",
    "开场后不要停在等待孩子回应；如果孩子没有马上回答，要主动进入课程介绍：说明今天分两遍学习，第一遍老师带读讲解，第二遍孩子朗读并获得发音和理解反馈，然后引导从封面开始。",
    "不要用“我们开始吧”“准备好了吧”这类模糊陈述作为停顿点。如果没有明确问孩子问题，也没有要求孩子朗读、回答或翻页，就继续讲下一小步。",
    "每次需要学生参与时，必须用明确问句或明确指令结尾，让孩子知道现在要回答、朗读还是翻页。",
    "讲解每一页时必须先看当前页标签/页码范围；例如“绘本页 8-9”，必须一轮只讲一侧，先讲第8页/左页，并围绕左页原文提出一个互动问题；学生回应后，再继续第9页/右页。一般绘本按左页到右页顺序讲解，不能跳过左页，也不能先讲右页，更不能一次把左右两页合在一起讲完。",
    "朗读或讲解原文时必须逐句覆盖当前页完整原文；可以在读完一句后简短解释，但不能漏掉原文句子，也不能把右页句子说成左页内容。",
    "朗读英文原文时发音要清楚、自然、偏儿童英语老师语气；英文句子要按正常英语语调完整朗读，不要把单词拆得过碎，不要用夸张升调，也不要把角色名读成普通单词。",
    "遇到 s-p-o-r-t-s 这类用连字符分隔的英文拼写时，只读字母本身，例如读成 s p o r t s；不要读出连字符、横杠、减号或任何标点符号。",
    "禁止用中文谐音标注英文发音，不要把英文单词拆成中文近似音，例如不要说 s（思）、p（批）这类内容；需要提示发音时，只能用自然英文示范或简短口型说明。",
    "每一侧页都要原文为主：先读该侧页原文，再结合原文里的词句做一个小互动，例如让孩子找关键词、回答一句意思、跟读一句或说说图里对应的动作。不要长篇讲解两侧页。",
    "讲当前侧页时，必须先完整朗读当前侧页的全部原文句子，不能只挑一句。比如左页原文是“Mum painted the go-kart. Chip helped. He was good at painting. \"It looks brilliant!\" said Biff.”时，这三句都必须读，再解释其中一两个重点。",
    "当你完成当前侧页的朗读、解释和互动问题后，必须等待学生语音回复或等待前端翻页指令；如果一直没有学生语音回复，也没有翻页，就停止说话。不要继续讲右页或下一页，不要补编未显示内容。",
    "只能讲当前可见页和当前页原文中已经发生的内容。禁止提前讲未翻到页面的后续剧情，禁止根据绘本常识或对话历史预测下一幕；不能把上一页线索编成当前页已经发生的事情。",
    "所有英文原文、剧情、人物动作和页码推进，必须来自当前页可信原文或当前屏幕清晰可见文字；禁止使用绘本记忆、书名常识、角色资料或旧对话补全当前页内容。",
    "例如：如果当前页可信原文没有“Wilma's dad helped them.”和“He started to make the go-kart.”，就不能朗读或讲解这些句子。",
    "例如：如果当前页没有画出或写出“踩到红油漆”，即使上一页提到油漆未干，也不能说 Kipper 已经踩到红油漆。",
    "",
    "##Agent陪学流程",
    agentLessonFlowPrompt,
    lessonState ? `\n##当前学习状态\n${lessonState}` : "",
    "如果当前学习状态包含“【看图说话RTC练习】”，这些看图说话规则必须覆盖默认两轮陪学流程：不要主动带读整页，不要直接泄露完整原文，先围绕当前画面引导学生自己回忆、描述和复述。",
    "如果学生已经上传资料并开启实时语音，你应自动进入学习引导模式。不要等待学生选择旧流程，也不要一次性讲完整套规则；用简短自然的话从当前步骤开始推进。",
    "",
    "##人物识别参考",
    formatStoryCharacterProfileForPrompt(),
    "使用人物卡时必须谨慎：只有画面特征或页面文字支持时才使用角色名；不确定时说“可能是”，不要把参考资料当成画面事实。",
  ].join("\n");

const isShadowRtcLessonState = (lessonState: string) =>
  /任务模式：影子跟读|影子跟读规则|当前影子跟读允许句子/.test(lessonState);

export const buildStartVoiceChatPayload = (session: RtcAgentStartRequest) => {
  const config = getRtcAgentConfig();
  return {
    AppId: config.appId,
    RoomId: session.roomId,
    TaskId: session.taskId,
    Config: {
      ASRConfig: {
        Provider: "volcano",
        ProviderParams: {
          Mode: "bigmodel",
          ApiResourceId: "volc.seedasr.sauc.duration",
          StreamMode: 2,
          VolcanoASRParameters: JSON.stringify({
            request: {
              enable_nonstream: true,
            },
          }),
        },
        VADConfig: {
          SilenceTime: 600,
        },
        InterruptConfig: {
          InterruptKeywords: [],
          InterruptSpeechDuration: 0,
        },
      },
      LLMConfig: {
        Mode: "ArkV3",
        BotId: config.botId,
        ModelName: config.modelName,
        SystemMessages: [buildSystemPrompt(session.lessonState || "")],
        ThinkingType: "disabled",
        VisionConfig: {
          Enable: true,
        },
        HistoryLength: isShadowRtcLessonState(session.lessonState || "") ? 1 : 10,
        Temperature: 0.1,
        TopP: 0.3,
        MaxTokens: 1024,
      },
      TTSConfig: {
        Provider: "volcano_bidirection",
        ProviderParams: {
          Credential: {
            ResourceId: "seed-tts-1.0",
          },
          VolcanoTTSParameters: JSON.stringify({
            req_params: {
              speaker: config.ttsSpeaker,
              audio_params: {
                speech_rate: config.ttsSpeechRate,
                loudness_rate: config.ttsLoudnessRate,
              },
              additions: {
                post_process: {
                  pitch: config.ttsPitch,
                },
              },
            },
          }),
        },
      },
      InterruptMode: 0,
      SubtitleConfig: {
        DisableRTSSubtitle: false,
        SubtitleMode: 0,
      },
      FunctionCallingConfig: {},
      WebSearchAgentConfig: {},
      MemoryConfig: {},
      MusicAgentConfig: {},
    },
    AgentConfig: {
      TargetUserId: [session.userId],
      UserId: session.agentUserId,
      WelcomeMessage: session.welcomeMessage ?? config.welcomeMessage,
      EnableConversationStateCallback: true,
      VoicePrint: {
        MetaList: null,
        VoicePrintList: null,
      },
    },
  };
};

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest();

const hmacHex = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value, "utf8").digest("hex");

const getAmzDate = (date = new Date()) =>
  date.toISOString().replace(/[:-]|\.\d{3}/g, "");

const signRtcOpenApiHeaders = ({
  action,
  body,
  ak,
  sk,
  date = new Date(),
}: {
  action: string;
  body: string;
  ak: string;
  sk: string;
  date?: Date;
}) => {
  const region = "cn-north-1";
  const service = "rtc";
  const version = "2025-06-01";
  const host = "rtc.volcengineapi.com";
  const xDate = getAmzDate(date);
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(version)}`;
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    "",
  ].join("\n");
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(sk, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const signingKey = hmac(kService, "request");
  const signature = hmacHex(signingKey, stringToSign);

  return {
    "Content-Type": "application/json",
    Host: host,
    "X-Date": xDate,
    "X-Content-Sha256": payloadHash,
    Authorization: `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
};

const callRtcOpenApi = async (action: string, body: Record<string, unknown>) => {
  const config = getRtcAgentConfig();
  const requestBody = JSON.stringify(body);
  const headers = signRtcOpenApiHeaders({
    action,
    body: requestBody,
    ak: config.ak,
    sk: config.sk,
  });

  const response = await fetch(
    `https://rtc.volcengineapi.com?Action=${encodeURIComponent(action)}&Version=2025-06-01`,
    {
      method: "POST",
      headers,
      body: requestBody,
    }
  );
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed && "ResponseMetadata" in parsed
        ? JSON.stringify((parsed as { ResponseMetadata?: unknown }).ResponseMetadata)
        : text;
    throw new Error(message || `${action} failed`);
  }

  return parsed;
};

export const startVoiceChat = (session: RtcAgentStartRequest) =>
  callRtcOpenApi("StartVoiceChat", buildStartVoiceChatPayload(session));

export const stopVoiceChat = (session: Pick<RtcAgentSession, "appId" | "roomId" | "taskId">) =>
  callRtcOpenApi("StopVoiceChat", {
    AppId: session.appId,
    RoomId: session.roomId,
    TaskId: session.taskId,
  });

export const interruptVoiceChat = (
  session: Pick<RtcAgentSession, "appId" | "roomId" | "taskId">
) =>
  callRtcOpenApi("UpdateVoiceChat", {
    AppId: session.appId,
    RoomId: session.roomId,
    TaskId: session.taskId,
    Command: "interrupt",
  });

export const sendExternalTextToLlm = (
  session: Pick<RtcAgentSession, "appId" | "roomId" | "taskId">,
  message: string
) =>
  callRtcOpenApi("UpdateVoiceChat", {
    AppId: session.appId,
    RoomId: session.roomId,
    TaskId: session.taskId,
    Command: "ExternalTextToLLM",
    InterruptMode: 1,
    Message: message,
  });

export const sendExternalPromptsForLlm = (
  session: Pick<RtcAgentSession, "appId" | "roomId" | "taskId">,
  message: string
) =>
  callRtcOpenApi("UpdateVoiceChat", {
    AppId: session.appId,
    RoomId: session.roomId,
    TaskId: session.taskId,
    Command: "ExternalPromptsForLLM",
    Message: message,
  });
