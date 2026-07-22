const fs = require("fs");
const http = require("http");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");

process.env.WS_NO_BUFFER_UTIL = "true";
process.env.WS_NO_UTF_8_VALIDATE = "true";

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.REALTIME_COACH_PORT || 3001);

const loadEnvFile = (fileName) => {
  const filePath = path.join(ROOT_DIR, fileName);
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValueParts] = trimmed.split("=");
    const key = rawKey.trim();
    if (!key || process.env[key]) continue;
    let value = rawValueParts.join("=").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
};

loadEnvFile(".env.local");
loadEnvFile(".env");

const EVENTS = {
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  UpdateConfig: 201,
  EndASR: 400,
  ClientInterrupt: 515,
  ConnectionStarted: 50,
  SessionStarted: 150,
  SessionFailed: 153,
  ASRResponse: 451,
  ASREnded: 459,
  TTSResponse: 352,
  TTSEnded: 359,
  ChatResponse: 550,
  ChatEnded: 559,
  DialogCommonError: 599,
};

const SESSION_EVENTS = new Set([
  EVENTS.SessionStarted,
  EVENTS.SessionFailed,
  EVENTS.ASRResponse,
  EVENTS.ASREnded,
  EVENTS.TTSResponse,
  EVENTS.TTSEnded,
  EVENTS.ChatResponse,
  EVENTS.ChatEnded,
  EVENTS.DialogCommonError,
]);

const getEnv = (name) => process.env[name]?.trim() || "";

const isImageDescriptionRequest = (value) =>
  /封面|画面|图片|图里|看图|看到|有什么|描述|讲讲.*图|介绍.*图|人物|发生|画了什么/.test(
    trimText(value, 220)
  );

const trimText = (value, maxLength = 900) => {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
};

const normalizeReferenceText = (value, maxLength = 420) =>
  trimText(value, maxLength)
    .toLowerCase()
    .replace(/\.(pdf|docx?|jpe?g|png|webp)\b/gi, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isFileReferenceText = (value, sourceName) => {
  const text = trimText(value, 420);
  if (!text) return false;
  if (/\.(pdf|docx?|jpe?g|png|webp)\b/i.test(text)) return true;

  const textKey = normalizeReferenceText(text);
  const sourceKey = normalizeReferenceText(sourceName);
  return Boolean(textKey && sourceKey && textKey === sourceKey);
};

const sanitizeTeachingText = (value, sourceName, maxLength = 900) => {
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

const getTtsSpeaker = (payload) => {
  const requested = trimText(payload?.ttsSpeaker || payload?.voiceId, 80);
  if (ALLOWED_TTS_SPEAKERS.has(requested)) return requested;
  return getEnv("DOUBAO_TTS_SPEAKER") || DEFAULT_TTS_SPEAKER;
};

const writeUInt32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};

const buildFullClientPayload = (event, payload, sessionId) => {
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

const buildAudioClientPayload = (event, audio, sessionId) => {
  const header = Buffer.from([0x11, 0x24, 0x10, 0x00]);
  const sessionBuffer = Buffer.from(sessionId, "utf8");
  return Buffer.concat([
    header,
    writeUInt32(event),
    writeUInt32(sessionBuffer.length),
    sessionBuffer,
    writeUInt32(sessionBuffer.length ? audio.length : audio.length),
    audio,
  ]);
};

const parseServerPayload = (input) => {
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

  if (SESSION_EVENTS.has(event) && input.length >= offset + 4) {
    const sessionIdSize = input.readUInt32BE(offset);
    if (sessionIdSize > 0 && sessionIdSize < 128 && input.length >= offset + 4 + sessionIdSize) {
      offset += 4 + sessionIdSize;
    }
  }

  const payloadSize = input.length >= offset + 4 ? input.readUInt32BE(offset) : 0;
  offset += 4;
  const payloadBytes = input.subarray(offset, offset + payloadSize);
  if (messageType === 0x0b || serialization === 0x00) {
    return { event, payload: null, audio: payloadBytes, error: "" };
  }

  const payloadText = payloadBytes.toString("utf8");
  try {
    return { event, payload: JSON.parse(payloadText), audio: null, error: "" };
  } catch {
    return { event, payload: payloadText, audio: null, error: "" };
  }
};

const getTeachingContextText = (payload, maxLength = 900) =>
  sanitizeTeachingText(
    payload?.aiTeachingContext?.currentPageText || payload?.pageText,
    payload?.bookTitle,
    maxLength
  );

const buildCoachHistoryPrompt = (payload) => {
  if (!Array.isArray(payload?.coachHistory) || !payload.coachHistory.length) return "";
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

const buildNavigationPrompt = (payload) => {
  const context = payload?.navigationContext;
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

const buildUiControlPrompt = (payload) => {
  const context = payload?.uiControlContext;
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

const buildTeachingContextPrompt = (payload) => {
  const context = payload?.aiTeachingContext;
  const currentPageText = getTeachingContextText(payload, 900);
  const previousPageText = sanitizeTeachingText(context?.previousPageText, payload?.bookTitle, 260);
  const nextPageText = sanitizeTeachingText(context?.nextPageText, payload?.bookTitle, 260);
  const visibleToStudent = context?.visibleToStudent || "image_only";
  const visualDescription = trimText(context?.visualDescription, 900);
  const instruction =
    trimText(context?.instruction, 420) ||
    "这些原文是 AI 教师后台上下文，学生不一定看得到。请用它们引导孩子回忆和复述原文，但不要直接泄露完整答案。";
  const allPageTexts = Array.isArray(context?.allPageTexts)
    ? context.allPageTexts
        .map((item, index) => {
          const pageLabel = trimText(item?.pageLabel, 40) || `第 ${index + 1} 页`;
          const text = sanitizeTeachingText(item?.text, payload?.bookTitle, 140);
          return text ? `${pageLabel}: ${text}` : "";
        })
        .filter(Boolean)
        .join(" | ")
    : "";
  const currentPageSegments = Array.isArray(context?.currentPageSegments)
    ? context.currentPageSegments
        .map((item, index, segments) => {
          const label = trimText(item?.label, 40);
          const text = sanitizeTeachingText(item?.text, payload?.bookTitle, 420);
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
    `学生当前可见状态：${
      visibleToStudent === "original"
        ? "已显示原文"
        : visibleToStudent === "hint"
          ? "只显示提示，不显示完整原文"
          : "只看图片，不显示原文"
    }`,
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
    "除非学生当前已显示原文，或明确要求答案，否则你只能用问题、关键词、首字母、完形提示、发音示范来引导，不要直接完整说出当前页原文。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildSystemRole = (payload) => {
  const mode = payload?.mode === "shadow" ? "影子跟读" : "看图说话";
  const isAgentMaterial = /Agent|自学资料|自己上传|上传的学习资料/.test(
    `${payload?.bookTitle || ""} ${payload?.aiTeachingContext?.instruction || ""}`
  );
  return [
    isAgentMaterial
      ? "你是一个真人感很强的儿童英语 AI 陪学老师，语气自然、温柔、活泼，像耐心的少儿英语老师。"
      : "你是一个真人感很强的儿童英语绘本 AI 语音教练，语气自然、温柔、活泼，像耐心的少儿英语老师。",
    `当前任务是${isAgentMaterial ? "Agent陪学" : mode}。`,
    `绘本：${trimText(payload?.bookTitle, 120) || "未命名绘本"}`,
    `当前页：${trimText(payload?.pageLabel, 80) || "当前页"}`,
    `当前目标原文：${getTeachingContextText(payload, 600) || "暂无文字"}`,
    `孩子当前看到的提示：${trimText(payload?.visiblePrompt, 600) || "无"}`,
    buildCoachHistoryPrompt(payload),
    buildNavigationPrompt(payload),
    buildUiControlPrompt(payload),
    buildTeachingContextPrompt(payload),
    "【语言状态规则，最高优先级】",
    "你始终保持“中文主导 + 必要英文示范”的双语老师状态。",
    "英文朗读输入不是英文聊天。孩子说英文时，优先判断为正在读绘本原句、练习英文表达或询问某个英文词，不要因此切换成纯英文回复。",
    "如果孩子读的是当前目标原文或相近句子，必须像老师点评朗读：先用中文鼓励，再用中文指出一个发音、重音或节奏点，只引用必要的英文词或短句示范，最后用中文引导继续。",
    isAgentMaterial
      ? "首次进入资料时不要直接讲课，先建立关系、说明规则、降低压力，并给孩子选择：“你想先听老师读一遍，还是你先试着读第一页？”"
      : "",
    isAgentMaterial
      ? "Agent陪学每页按“看图 → 老师提问 → 老师示范读 → 孩子跟读 → 老师轻反馈 → 下一页”的节奏推进。孩子选择老师先读时，示范朗读当前页正文；孩子选择自己先读时，邀请孩子读并说明读错没关系。"
      : "",
    "孩子可以问你任何问题。如果孩子跑题太久，先接住问题，再自然带回当前绘本练习。",
    "每次回答控制在 1 到 3 句。多鼓励，少说教。",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildDialogConfig = (payload) => ({
  bot_name: "Mia老师",
  system_role: buildSystemRole(payload),
  speaking_style:
    "像耐心的少儿英语老师一样说话。中文为主，不因孩子读英文原句就切换成纯英文；英文只用于原句、关键词、发音示范。短句，先鼓励再提示。",
  dialog_id: "",
});

const buildStartSessionPayload = (payload) => ({
  dialog: {
    ...buildDialogConfig(payload),
    extra: {
      input_mod: "push_to_talk",
      model: "1.2.1.1",
      strict_audit: true,
    },
  },
  tts: {
    speaker: getTtsSpeaker(payload),
    audio_config: {
      channel: 1,
      format: "pcm_s16le",
      sample_rate: 24000,
    },
  },
  asr: {
    audio_info: {
      format: "pcm_s16le",
      sample_rate: 16000,
      channel: 1,
    },
  },
});

const buildUpdateConfigPayload = (payload) => ({
  dialog: buildDialogConfig(payload),
});

const sendJson = (client, payload) => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
};

const extractErrorMessage = (payload, fallback) => {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return fallback;
  return (
    payload.message ||
    payload.error ||
    payload.error_msg ||
    payload.err_msg ||
    payload.reason ||
    fallback
  );
};

const createSessionState = (client) => ({
  client,
  upstream: null,
  sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  connectId: `connect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  payload: {},
  ready: false,
  audioQueue: [],
  reply: "",
  asrText: "",
  turnEndTimer: null,
  suppressTtsUntil: 0,
  suppressResponseUntil: 0,
});

const clearTurnEndTimer = (state) => {
  if (state.turnEndTimer) {
    clearTimeout(state.turnEndTimer);
    state.turnEndTimer = null;
  }
};

const emitTurnEnd = (state) => {
  clearTurnEndTimer(state);
  const reply = state.reply.trim();
  const asrText = state.asrText.trim();
  if (!reply && !asrText) return;
  sendJson(state.client, {
    type: "turn_end",
    reply,
    asrText,
  });
  state.reply = "";
  state.asrText = "";
};

const scheduleTurnEndFallback = (state, delayMs = 1800) => {
  clearTurnEndTimer(state);
  state.turnEndTimer = setTimeout(() => {
    state.turnEndTimer = null;
    emitTurnEnd(state);
  }, delayMs);
};

const connectDoubao = (state, initialPayload) => {
  const endpoint =
    getEnv("VOLCENGINE_URL") ||
    getEnv("DOUBAO_REALTIME_URL") ||
    "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
  const apiKey = getEnv("DOUBAO_API_KEY");
  const appId = getEnv("DOUBAO_REALTIME_APP_ID") || getEnv("RTC_APP_ID");
  const accessKey =
    getEnv("DOUBAO_REALTIME_ACCESS_TOKEN") || getEnv("RTC_ACCESS_KEY") || getEnv("DOUBAO_API_KEY");
  const resourceId =
    getEnv("DOUBAO_REALTIME_RESOURCE_ID") || getEnv("RTC_RESOURCE_ID") || "volc.speech.dialog";
  const appKey = getEnv("DOUBAO_REALTIME_APP_KEY") || getEnv("RTC_APP_KEY");
  const hasAppIdAuth = Boolean(appId && accessKey);
  const hasApiKeyAuth = Boolean(apiKey);

  if (!hasAppIdAuth && !hasApiKeyAuth) {
    sendJson(state.client, {
      type: "error",
      error: "缺少豆包实时语音鉴权配置：请配置 DOUBAO_API_KEY",
    });
    return;
  }

  state.payload = initialPayload || {};
  const headers = {
    ...(hasAppIdAuth ? { "X-Api-App-ID": appId, "X-Api-Access-Key": accessKey } : { "X-Api-Key": apiKey }),
    "X-Api-Resource-Id": resourceId,
    "X-Api-App-Key": appKey,
    "X-Api-Connect-Id": state.connectId,
  };

  const upstream = new WebSocket(endpoint, { headers });
  state.upstream = upstream;

  upstream.on("open", () => {
    upstream.send(buildFullClientPayload(EVENTS.StartConnection, {}));
  });

  upstream.on("message", (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const parsed = parseServerPayload(buffer);
    if (!parsed) return;
    if (parsed.error) {
      sendJson(state.client, { type: "error", error: parsed.error });
      return;
    }

    if (parsed.event === EVENTS.ConnectionStarted) {
      upstream.send(
        buildFullClientPayload(
          EVENTS.StartSession,
          buildStartSessionPayload(state.payload),
          state.sessionId
        )
      );
      return;
    }

    if (parsed.event === EVENTS.SessionStarted) {
      state.ready = true;
      sendJson(state.client, { type: "ready" });
      while (state.audioQueue.length) {
        upstream.send(buildAudioClientPayload(EVENTS.TaskRequest, state.audioQueue.shift(), state.sessionId));
      }
      return;
    }

    if (parsed.event === EVENTS.SessionFailed || parsed.event === EVENTS.DialogCommonError) {
      sendJson(state.client, {
        type: "error",
        error: extractErrorMessage(parsed.payload, "豆包实时语音会话返回错误"),
      });
      return;
    }

    if (parsed.event === EVENTS.ASRResponse && parsed.payload && typeof parsed.payload === "object") {
      const results = Array.isArray(parsed.payload.results) ? parsed.payload.results : [];
      const text = results
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join(" ")
        .trim();
      const isFinal = results.some((item) => item?.is_interim === false);
      if (text) {
        if (isFinal) state.asrText = text;
        sendJson(state.client, { type: isFinal ? "asr" : "asr_interim", text });
        if (isFinal && isImageDescriptionRequest(text)) {
          state.reply = "";
          state.asrText = "";
          state.suppressResponseUntil = Date.now() + 12_000;
          state.suppressTtsUntil = Date.now() + 12_000;
          clearTurnEndTimer(state);
          sendJson(state.client, { type: "visual_question", text });
          if (state.upstream?.readyState === WebSocket.OPEN && state.ready) {
            state.upstream.send(buildFullClientPayload(EVENTS.ClientInterrupt, {}, state.sessionId));
          }
          return;
        }
        if (isFinal) scheduleTurnEndFallback(state, 4200);
      }
      return;
    }

    if (parsed.event === EVENTS.ChatResponse && parsed.payload && typeof parsed.payload === "object") {
      if (Date.now() < state.suppressResponseUntil) return;
      const content = parsed.payload.content;
      if (typeof content === "string" && content) {
        state.reply += content;
        sendJson(state.client, { type: "reply_delta", text: content });
        scheduleTurnEndFallback(state);
      }
      return;
    }

    if (parsed.event === EVENTS.ChatEnded) {
      emitTurnEnd(state);
      return;
    }

    if (parsed.event === EVENTS.TTSResponse && parsed.audio?.length) {
      if (Date.now() < state.suppressTtsUntil) return;
      clearTurnEndTimer(state);
      if (state.client.readyState === WebSocket.OPEN) {
        state.client.send(parsed.audio);
      }
      return;
    }

    if (parsed.event === EVENTS.TTSEnded) {
      emitTurnEnd(state);
    }
  });

  upstream.on("error", (error) => {
    sendJson(state.client, {
      type: "error",
      error: error instanceof Error ? error.message : "豆包实时语音连接失败",
    });
  });

  upstream.on("close", () => {
    state.ready = false;
    emitTurnEnd(state);
    sendJson(state.client, { type: "closed" });
  });
};

const closeUpstream = (state) => {
  clearTurnEndTimer(state);
  if (!state.upstream || state.upstream.readyState !== WebSocket.OPEN) return;
  try {
    state.upstream.send(buildFullClientPayload(EVENTS.FinishSession, {}, state.sessionId));
    state.upstream.send(buildFullClientPayload(EVENTS.FinishConnection, {}));
  } catch {
    // ignore shutdown errors
  }
  state.upstream.close();
};

const handleClientJson = (state, message) => {
  if (message.type === "start") {
    closeUpstream(state);
    state.ready = false;
    state.audioQueue = [];
    state.reply = "";
    state.asrText = "";
    state.suppressTtsUntil = 0;
    state.suppressResponseUntil = 0;
    state.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    state.connectId = `connect_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    connectDoubao(state, message.payload || {});
    return;
  }

  if (message.type === "context") {
    state.payload = message.payload || state.payload || {};
    if (state.upstream?.readyState === WebSocket.OPEN && state.ready) {
      state.upstream.send(
        buildFullClientPayload(
          EVENTS.UpdateConfig,
          buildUpdateConfigPayload(state.payload),
          state.sessionId
        )
      );
    }
    return;
  }

  if (message.type === "end_asr") {
    state.reply = "";
    state.asrText = "";
    state.suppressTtsUntil = Date.now() + 1800;
    state.suppressResponseUntil = Date.now() + 300;
    if (state.upstream?.readyState === WebSocket.OPEN && state.ready) {
      state.upstream.send(buildFullClientPayload(EVENTS.EndASR, {}, state.sessionId));
    }
    return;
  }

  if (message.type === "interrupt") {
    state.reply = "";
    state.suppressTtsUntil = Date.now() + 3500;
    state.suppressResponseUntil = Date.now() + 1200;
    if (state.upstream?.readyState === WebSocket.OPEN && state.ready) {
      state.upstream.send(buildFullClientPayload(EVENTS.ClientInterrupt, {}, state.sessionId));
    }
  }
};

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server, path: "/storyflow/doubao-stream" });

wss.on("connection", (client) => {
  const state = createSessionState(client);

  client.on("message", (data, isBinary) => {
    if (isBinary) {
      const audio = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (state.upstream?.readyState === WebSocket.OPEN && state.ready) {
        state.upstream.send(buildAudioClientPayload(EVENTS.TaskRequest, audio, state.sessionId));
      } else {
        state.audioQueue.push(audio);
      }
      return;
    }

    try {
      handleClientJson(state, JSON.parse(data.toString("utf8")));
    } catch {
      sendJson(client, { type: "error", error: "实时语音消息格式错误" });
    }
  });

  client.on("close", () => closeUpstream(state));
  client.on("error", () => closeUpstream(state));
});

server.listen(PORT, () => {
  console.log(`[realtime-coach] WebSocket proxy listening on ws://localhost:${PORT}/storyflow/doubao-stream`);
});
