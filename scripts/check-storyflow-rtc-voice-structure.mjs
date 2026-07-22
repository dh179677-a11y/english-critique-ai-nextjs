import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../components/student/StoryflowTaskPlayer.tsx", import.meta.url),
  "utf8"
);
const rtcAgentSource = await readFile(
  new URL("../lib/volcRtcAgent.ts", import.meta.url),
  "utf8"
);
const externalPromptsRouteSource = await readFile(
  new URL("../app/api/agent-rtc/external-prompts-for-llm/route.ts", import.meta.url),
  "utf8"
).catch(() => "");
const storyflowStoreSource = await readFile(
  new URL("../lib/storyflowStore.ts", import.meta.url),
  "utf8"
);
const assignmentsSource = await readFile(
  new URL("../lib/storyflowAssignments.ts", import.meta.url),
  "utf8"
);
const teacherWorkspaceSource = await readFile(
  new URL("../components/teacher/StoryflowWorkspace.tsx", import.meta.url),
  "utf8"
);

const beginCoachSession =
  source.match(/const beginCoachSession = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const stopCoachSession =
  source.match(/const stopCoachSession = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const storyflowUnmountCleanup =
  source.match(/useEffect\(\(\) => \{\s*return \(\) => \{[\s\S]*?shadowAudioTokenRef\.current \+= 1[\s\S]*?\n    \};\s*\}, \[\]\);/u)
    ?.[0] || "";
const beginCoachRtcSession =
  source.match(/const beginCoachRtcSession = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const buildCoachRtcWelcomeMessage =
  source.match(/const buildCoachRtcWelcomeMessage = \(\) =>(?: \{([\s\S]*?)\n  \};|([\s\S]*?);)/u)
    ?.slice(1)
    .find(Boolean) || "";
const askAiCoach =
  source.match(/const askAiCoach = async \(rawMessage: string\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const stopCoachRtcAgentSession =
  source.match(/const stopCoachRtcAgentSession = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const safeDestroyCoachRtcEngine =
  source.match(/const safeDestroyCoachRtcEngine = async \(engine\?: CoachRtcEngine \| null\) => \{([\s\S]*?)\n  \};/u)
    ?.[1] || "";
const notifyCoachRtcPageChanged =
  source.match(/const notifyCoachRtcPageChanged = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const sendCoachRtcAgentContextPrompt =
  source.match(/const sendCoachRtcAgentContextPrompt = async \(message: string\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const sendCoachRtcShadowCurrentSentencePrompt =
  source.match(/const sendCoachRtcShadowCurrentSentencePrompt = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const scheduleCoachRtcShadowCurrentSentencePrompt =
  source.match(/const scheduleCoachRtcShadowCurrentSentencePrompt = \(delayMs = 260\) => \{([\s\S]*?)\n  \};/u)
    ?.[1] || "";
const pauseCoachRtcMicrophoneForShadowAudio =
  source.match(/const pauseCoachRtcMicrophoneForShadowAudio = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const resumeCoachRtcMicrophoneAfterShadowAudio =
  source.match(/const resumeCoachRtcMicrophoneAfterShadowAudio = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const prepareCoachRtcForShadowSourceAudio =
  source.match(/const prepareCoachRtcForShadowSourceAudio = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const playShadowAudioSequence =
  source.match(/const playShadowAudioSequence = \([\s\S]*?\n  \};/u)?.[0] || "";
const startCurrentShadowAudioPlayback =
  source.match(/const startCurrentShadowAudioPlayback = async \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const buildCoachRtcLessonStatePrompt =
  source.match(/const buildCoachRtcLessonStatePrompt = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const correctCoachRtcTranscriptAgainstCurrentText =
  source.match(/const correctCoachRtcTranscriptAgainstCurrentText = \(text: string\) => \{([\s\S]*?)\n  \};/u)
    ?.[1] || "";
const extractCoachRtcMessageText =
  source.match(/const extractCoachRtcMessageText = \(value: unknown\): string => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const inferCoachVoiceSubtitleRole =
  source.match(/const inferCoachVoiceSubtitleRole = \([\s\S]*?\n  \};/u)?.[0] || "";
const collectCoachRtsSubtitleItems =
  source.match(/const collectCoachRtsSubtitleItems = \([\s\S]*?\n  \};/u)?.[0] || "";
const aiCoachPanelStart = source.indexOf("const aiCoachPanel =");
const aiCoachPanelEnd =
  aiCoachPanelStart >= 0 ? source.indexOf('  if (resolvedTaskMode === "shadow") {', aiCoachPanelStart) : -1;
const aiCoachPanel =
  aiCoachPanelStart >= 0 && aiCoachPanelEnd > aiCoachPanelStart
    ? source.slice(aiCoachPanelStart, aiCoachPanelEnd)
    : "";
const shadowPageStart = source.indexOf('if (resolvedTaskMode === "shadow") {');
const shadowPageEnd = shadowPageStart >= 0 ? source.indexOf("\nconst ShadowPage", shadowPageStart) : -1;
const shadowPageBranch =
  shadowPageStart >= 0 && shadowPageEnd > shadowPageStart
    ? source.slice(shadowPageStart, shadowPageEnd)
    : "";
const shadowAutoPlayEffect =
  source.match(
    /useEffect\(\(\) => \{\s*if \(resolvedTaskMode !== "shadow"\)[\s\S]*?startCurrentShadowAudioPlayback\(\)\.then[\s\S]*?\}, \[resolvedTaskMode, shadowAutoPlayKey, hasShadowAudio[^\]]*\]\);/u
  )?.[0] || "";

assert.ok(beginCoachSession, "beginCoachSession implementation was not found");
assert.ok(stopCoachSession, "stopCoachSession implementation was not found");
assert.ok(storyflowUnmountCleanup, "storyflow unmount cleanup implementation was not found");
assert.ok(beginCoachRtcSession, "beginCoachRtcSession implementation was not found");
assert.ok(buildCoachRtcWelcomeMessage, "buildCoachRtcWelcomeMessage implementation was not found");
assert.ok(askAiCoach, "askAiCoach implementation was not found");
assert.ok(stopCoachRtcAgentSession, "stopCoachRtcAgentSession implementation was not found");
assert.ok(safeDestroyCoachRtcEngine, "safeDestroyCoachRtcEngine implementation was not found");
assert.ok(notifyCoachRtcPageChanged, "notifyCoachRtcPageChanged implementation was not found");
assert.ok(sendCoachRtcAgentContextPrompt, "sendCoachRtcAgentContextPrompt implementation was not found");
assert.ok(
  sendCoachRtcShadowCurrentSentencePrompt,
  "sendCoachRtcShadowCurrentSentencePrompt implementation was not found"
);
assert.ok(
  scheduleCoachRtcShadowCurrentSentencePrompt,
  "scheduleCoachRtcShadowCurrentSentencePrompt implementation was not found"
);
assert.ok(
  pauseCoachRtcMicrophoneForShadowAudio,
  "pauseCoachRtcMicrophoneForShadowAudio implementation was not found"
);
assert.ok(
  resumeCoachRtcMicrophoneAfterShadowAudio,
  "resumeCoachRtcMicrophoneAfterShadowAudio implementation was not found"
);
assert.ok(
  prepareCoachRtcForShadowSourceAudio,
  "prepareCoachRtcForShadowSourceAudio implementation was not found"
);
assert.ok(playShadowAudioSequence, "playShadowAudioSequence implementation was not found");
assert.ok(
  startCurrentShadowAudioPlayback,
  "startCurrentShadowAudioPlayback implementation was not found"
);
assert.ok(buildCoachRtcLessonStatePrompt, "buildCoachRtcLessonStatePrompt implementation was not found");
assert.ok(
  correctCoachRtcTranscriptAgainstCurrentText,
  "correctCoachRtcTranscriptAgainstCurrentText implementation was not found"
);
assert.ok(extractCoachRtcMessageText, "extractCoachRtcMessageText implementation was not found");
assert.ok(inferCoachVoiceSubtitleRole, "inferCoachVoiceSubtitleRole implementation was not found");
assert.ok(collectCoachRtsSubtitleItems, "collectCoachRtsSubtitleItems implementation was not found");
assert.ok(aiCoachPanel, "speaking/shadow floating coach panel was not found");
assert.ok(shadowPageBranch, "shadow page branch was not found");
assert.ok(shadowAutoPlayEffect, "shadow autoplay effect was not found");

assert.match(
  beginCoachSession,
  /coachRtcStartInFlightRef\.current[\s\S]*return[\s\S]*coachRtcStartInFlightRef\.current = true[\s\S]*await beginCoachRtcSession\(\)[\s\S]*coachRtcStartInFlightRef\.current = false/u,
  "speaking/shadow realtime voice must guard against duplicate RTC starts while a session is connecting"
);
assert.doesNotMatch(
  beginCoachSession,
  /startCoachStreamingSession|scheduleCoachListening/u,
  "speaking/shadow realtime voice entry must not start the old websocket realtime path"
);
assert.match(
  stopCoachSession,
  /interruptCoachRtcOutput\(\)[\s\S]*stopShadowAudioPlayback\(\{ resumeRtcMic: false \}\)[\s\S]*stopShadowRecording\(\)[\s\S]*stopCoachRtcAgentSession\(\)/u,
  "realtime voice switch-off must be a hard stop for RTC output, shadow source audio, and shadow recording"
);
assert.match(
  storyflowUnmountCleanup,
  /stopCoachSession\(\)/u,
  "leaving storyflow pages must hard-stop the RTC coach session so an old AI voice cannot keep talking off-screen"
);
assert.match(
  beginCoachRtcSession,
  /\/api\/agent-rtc\/session[\s\S]*@volcengine\/rtc[\s\S]*\/api\/agent-rtc\/start/u,
  "storyflow realtime voice must use the same RTC session/start structure as AgentStudy"
);
assert.doesNotMatch(
  beginCoachRtcSession,
  /coachRtcStartInFlightRef\.current = true/u,
  "RTC start lock must live in beginCoachSession so every UI entry shares the same guard"
);
assert.match(
  beginCoachRtcSession,
  /startCoachRtcVisualTrack[\s\S]*engine\.publishStream\(hasVisualTrack \? MediaType\.AUDIO_AND_VIDEO : MediaType\.AUDIO\)/u,
  "storyflow RTC must publish microphone plus current page visual track"
);
assert.match(
  beginCoachRtcSession,
  /lessonState:\s*buildCoachRtcLessonStatePrompt\(\)/u,
  "storyflow RTC start must send a task-specific lesson state prompt"
);
assert.match(
  beginCoachRtcSession,
  /const welcomeMessage = buildCoachRtcWelcomeMessage\(\)[\s\S]*welcomeMessage,/u,
  "storyflow RTC start must use the storyflow-specific RTC welcome message"
);
assert.match(
  source,
  /hasIntroducedShadowRtcRulesRef = useRef\(false\)/u,
  "shadow reading RTC must remember whether the initial rules have already been introduced"
);
assert.match(
  buildCoachRtcWelcomeMessage,
  /resolvedTaskMode === "shadow"[\s\S]*hasIntroducedShadowRtcRulesRef\.current[\s\S]*我们继续刚才的学习[\s\S]*SHADOW_RTC_WELCOME_MESSAGES/u,
  "shadow reading first RTC start must introduce shadow-reading rules, while later resumes only continue the previous study"
);
assert.match(
  source,
  /SHADOW_RTC_WELCOME_MESSAGES[\s\S]*跟着原音一句一句读，模仿发音、语调和节奏/u,
  "shadow reading first welcome messages must include a clear shadow-reading rule prompt"
);
assert.match(
  beginCoachRtcSession,
  /resolvedTaskMode === "shadow"[\s\S]*stopShadowAudioPlayback\(\)[\s\S]*\/api\/agent-rtc\/start/u,
  "starting shadow RTC voice must stop any currently playing source audio before Mia's welcome voice starts"
);
assert.doesNotMatch(
  shadowAutoPlayEffect,
  /coachRtcStartedRef\.current[\s\S]*return/u,
  "shadow source-audio autoplay must keep working while RTC voice is active"
);
assert.match(
  shadowAutoPlayEffect,
  /startCurrentShadowAudioPlayback\(\)/u,
  "shadow source-audio autoplay must still start the current page audio"
);
assert.match(
  prepareCoachRtcForShadowSourceAudio,
  /interruptCoachRtcOutput\(\)[\s\S]*pauseCoachRtcMicrophoneForShadowAudio\(\)/u,
  "shadow source-audio playback must interrupt Mia and pause RTC microphone upload before playing the source audio"
);
assert.match(
  pauseCoachRtcMicrophoneForShadowAudio,
  /stopAudioCapture/u,
  "pausing shadow source audio must mute only microphone capture"
);
assert.doesNotMatch(
  pauseCoachRtcMicrophoneForShadowAudio,
  /unpublishStream|publishStream/u,
  "pausing shadow source audio must not unpublish the RTC stream because that can break the visual track"
);
assert.match(
  resumeCoachRtcMicrophoneAfterShadowAudio,
  /startAudioCapture/u,
  "resuming after source audio must restart microphone capture"
);
assert.doesNotMatch(
  resumeCoachRtcMicrophoneAfterShadowAudio,
  /unpublishStream|publishStream/u,
  "resuming after source audio must not republish the RTC stream because the visual track must stay published"
);
assert.match(
  startCurrentShadowAudioPlayback,
  /stopShadowAudioPlayback\(\)[\s\S]*await prepareCoachRtcForShadowSourceAudio\(\)[\s\S]*playShadowAudioSequence/u,
  "shadow autoplay must pause RTC listening before the source audio begins"
);
assert.match(
  playShadowAudioSequence,
  /setIsPlayingShadowAudio\(false\)[\s\S]*resumeCoachRtcMicrophoneAfterShadowAudio\(\)/u,
  "shadow source-audio playback must restore RTC microphone upload after the source audio finishes"
);
assert.match(
  notifyCoachRtcPageChanged,
  /resolvedTaskMode === "shadow"[\s\S]*setCoachInterimText\("Mia 已看到当前句，正在同步跟读句子。"\)[\s\S]*return/u,
  "shadow page changes must refresh the RTC visual track without triggering Mia to speak over the source audio"
);
assert.ok(
  notifyCoachRtcPageChanged.indexOf('if (resolvedTaskMode === "shadow")') <
    notifyCoachRtcPageChanged.indexOf("const message = ["),
  "shadow page changes must return before building an ExternalTextToLLM prompt"
);
assert.match(
  notifyCoachRtcPageChanged,
  /resolvedTaskMode === "shadow"[\s\S]*scheduleCoachRtcShadowCurrentSentencePrompt\(\)[\s\S]*return/u,
  "shadow page changes must schedule a current-sentence sync so Mia does not keep using an old sentence"
);
assert.match(
  rtcAgentSource,
  /Command:\s*"ExternalPromptsForLLM"/u,
  "silent RTC context sync must use ExternalPromptsForLLM"
);
assert.match(
  externalPromptsRouteSource,
  /sendExternalPromptsForLlm/u,
  "external-prompts-for-llm route must call the silent RTC context sync helper"
);
assert.match(
  sendCoachRtcAgentContextPrompt,
  /\/api\/agent-rtc\/external-prompts-for-llm/u,
  "shadow current-sentence context sync must call the silent prompt route"
);
assert.doesNotMatch(
  sendCoachRtcAgentContextPrompt,
  /external-text-to-llm/u,
  "shadow current-sentence context sync must not call the speaking ExternalTextToLLM route"
);
assert.doesNotMatch(
  scheduleCoachRtcShadowCurrentSentencePrompt,
  /shadowAudioRef\.current[\s\S]*!shadowAudioRef\.current\.paused[\s\S]*scheduleCoachRtcShadowCurrentSentencePrompt/u,
  "silent shadow current-sentence sync must not wait for source audio to finish"
);
assert.match(
  sendCoachRtcShadowCurrentSentencePrompt,
  /aiCoachPageText[\s\S]*sendCoachRtcAgentContextPrompt[\s\S]*buildCoachRtcLessonStatePrompt\(\)/u,
  "shadow current-sentence sync must silently send the active trusted sentence to the RTC agent"
);
assert.doesNotMatch(
  sendCoachRtcShadowCurrentSentencePrompt,
  /sendCoachRtcAgentControlMessage/u,
  "shadow current-sentence sync must not trigger a speaking RTC message"
);
assert.match(
  sendCoachRtcShadowCurrentSentencePrompt,
  /不能使用旧句子|当前唯一允许跟读句/u,
  "shadow current-sentence sync must explicitly forbid old sentences"
);
assert.match(
  sendCoachRtcShadowCurrentSentencePrompt,
  /静默上下文同步|不要因为这条上下文主动说话/u,
  "shadow current-sentence sync must explicitly tell RTC not to speak from the sync message"
);
assert.doesNotMatch(
  source,
  /getRealtimeCoachWebSocketUrl|new WebSocket|startCoachStreamingSession|stopCoachStreamingSession|scheduleCoachListening|startCoachListening|stopCoachListening|playCoachAudioReply|stopCoachAudioReply|stopCoachVoiceCapture|coachStream|coachPcm|coachVoiceRecorderRef|coachVad|coachListeningTimerRef|coachRestartTimerRef|audioPcmBase64|renderAudioToPcm16Base64|\/api\/storyflow\/doubao-realtime-turn|\/api\/storyflow\/doubao-coach/u,
  "storyflow speaking/shadow pages must not include the old websocket, local recorder, or local HTTP audio fallback path"
);
assert.match(
  source,
  /const lastCoachRtcTaskModeRef = useRef<TaskMode \| null>\(null\)/u,
  "storyflow RTC must remember the owning task mode so shadow and speaking agents cannot overlap"
);
assert.match(
  source,
  /resolvedTaskMode[\s\S]*lastCoachRtcTaskModeRef\.current[\s\S]*stopCoachSession\(\)/u,
  "switching between shadow reading and speaking practice must stop the previous RTC agent session"
);
assert.match(
  source,
  /view === "overview"[\s\S]*coachSessionActiveRef\.current[\s\S]*stopCoachSession\(\)/u,
  "returning to the Storyflow overview must stop any shadow/speaking RTC agent session"
);
assert.match(
  source,
  /onSubtitleMessageReceived[\s\S]*upsertCoachRtcTranscriptMessage/u,
  "storyflow RTC must listen to RTC subtitles and render them in Mia panel"
);
assert.match(
  beginCoachRtcSession,
  /startSubtitle\?\.\(\{ mode: 0 \}\)/u,
  "storyflow RTC must actively start client subtitles so student speech appears in the transcript"
);
assert.doesNotMatch(
  beginCoachRtcSession,
  /if \(!userId \|\| !text\) return/u,
  "SDK subtitle handler must not drop student speech subtitles just because the packet omits userId"
);
assert.match(
  beginCoachRtcSession,
  /inferCoachVoiceSubtitleRole\(\s*subtitle,\s*sessionPayload,/u,
  "SDK subtitle handler must infer student/teacher roles from subtitle metadata"
);
assert.match(source, /collectCoachRtsSubtitleItems/u, "storyflow RTC must collect RTS subtitle items");
assert.match(source, /inferCoachVoiceSubtitleRole/u, "storyflow RTC must infer student/teacher subtitle roles");
assert.match(source, /isInternalCoachRtcControlText/u, "storyflow RTC must hide internal RTC control prompts from subtitles");
assert.match(
  extractCoachRtcMessageText,
  /asr_result[\s\S]*recognitionText[\s\S]*transcriptText[\s\S]*displayText[\s\S]*translation/u,
  "student ASR subtitles must parse common Volcengine recognition text fields"
);
assert.match(
  extractCoachRtcMessageText,
  /for \(const key of \["data", "payload", "result", "body", "detail", "extra"\]/u,
  "student ASR subtitles must parse common nested Volcengine payload fields"
);
assert.match(
  source,
  /const getCoachRtcUserId[\s\S]*participantId[\s\S]*sourceUserId[\s\S]*targetUserId[\s\S]*inferCoachVoiceSubtitleRole[\s\S]*isMe[\s\S]*isLocal/u,
  "student ASR subtitle role inference must recognize local-user identity fields"
);
assert.match(
  source,
  /startLocalStudentSpeechSubtitles[\s\S]*upsertCoachRtcTranscriptMessage[\s\S]*role:\s*"student"[\s\S]*stopLocalStudentSpeechSubtitles/u,
  "speaking practice must mirror local student speech into subtitles when RTC does not emit local ASR"
);
assert.match(
  source,
  /const getLocalStudentSpeechRecognitionLang = \(\)[\s\S]*resolvedTaskMode === "intensive"[\s\S]*zh-CN[\s\S]*en-US[\s\S]*recognition\.lang = getLocalStudentSpeechRecognitionLang\(\)/u,
  "local student subtitle mirroring must not force en-US during Chinese intensive-reading answers"
);
assert.match(
  source,
  /const getLocalStudentSpeechRecognitionLang = \(\)[\s\S]*resolvedTaskMode === "speaking"[\s\S]*zh-CN[\s\S]*recognition\.lang = getLocalStudentSpeechRecognitionLang\(\)/u,
  "speaking practice local student subtitles must use zh-CN so Chinese and mixed Chinese-English answers are not turned into unrelated English captions"
);
assert.doesNotMatch(
  source.match(/const startLocalStudentSpeechSubtitles = \(\) => \{[\s\S]*?\n  \};/u)?.[0] || "",
  /recognition\.lang = "en-US"/u,
  "local student subtitle mirroring must not hard-code en-US because Chinese answers become unrelated English captions"
);
assert.doesNotMatch(
  source.match(/const startLocalStudentSpeechSubtitles = \(\) => \{[\s\S]*?\n  \};/u)?.[0] || "",
  /sendCoachRtcAgentControlMessage|external-text-to-llm|fetch\(/u,
  "local student subtitle mirroring must not trigger a second AI voice turn"
);
assert.match(
  source,
  /coachMessagesRef[\s\S]*isLikelyCoachEchoLocalStudentTranscript[\s\S]*role === "coach"[\s\S]*startLocalStudentSpeechSubtitles[\s\S]*isLikelyCoachEchoLocalStudentTranscript\(text\)/u,
  "local student subtitle mirroring must discard browser ASR echoes of Mia's recent speech"
);
assert.match(
  source,
  /hasCjkLocalTranscriptEcho[\s\S]*normalized\.length < \(hasCjkLocalTranscriptEcho \? 6 : 10\)[\s\S]*getLocalTranscriptSimilarity\(normalized, coachText\) >= \(hasCjkLocalTranscriptEcho \? 0\.56 : 0\.62\)/u,
  "local student subtitle mirroring must also discard short Chinese echoes such as Mia's opening phrase"
);
assert.match(
  source,
  /hasCjkLocalTranscriptEcho[\s\S]*normalized\.length >= 2[\s\S]*coachText\.startsWith\(normalized\)[\s\S]*normalized\.length < \(hasCjkLocalTranscriptEcho \? 6 : 10\)/u,
  "local student subtitle mirroring must discard two-character Chinese prefix echoes before applying the general minimum length gate"
);
assert.match(
  source,
  /isCoachRemoteAudioActive\(\)[\s\S]*hasCjkLocalTranscriptEcho[\s\S]*normalized\.length === 1[\s\S]*coachText\.startsWith\(normalized\)/u,
  "local student subtitle mirroring must discard one-character Chinese opening echoes like Mia's '我' while audio is playing"
);
assert.match(
  source,
  /resolvedTaskMode === "speaking"[\s\S]*isCoachRemoteAudioActive\(\)[\s\S]*hasCjkLocalTranscriptEcho[\s\S]*normalized\.length <= 2/u,
  "speaking practice must discard one- or two-character Chinese local ASR fragments while Mia is still speaking"
);
assert.match(
  source,
  /resolvedTaskMode === "speaking"[\s\S]*isCoachRemoteAudioActive\(\)[\s\S]*\/\^\(没关系\|不对\|你看\|想一想\|我们慢/u,
  "speaking practice must discard common longer Mia feedback echoes while Mia is still speaking"
);
assert.match(
  source,
  /filter\(\(message\) =>[\s\S]*\\p\{Script=Han\}[\s\S]*message\.length >= 4[\s\S]*message\.length >= 10/u,
  "local student subtitle mirroring must keep short Chinese Mia phrases like '没关系我们再试试' in the echo candidate pool"
);
assert.match(
  source,
  /coachRecentSpeechEchoTextsRef[\s\S]*role === "coach"[\s\S]*coachRecentSpeechEchoTextsRef\.current/u,
  "local student subtitle mirroring must keep a synchronous cache of Mia's recent speech for echo filtering"
);
assert.match(
  source,
  /isCoachRemoteAudioActive\(\)[\s\S]*getLocalTranscriptSimilarity\(normalized, coachText, 2\) >= 0\.62/u,
  "local student subtitle mirroring must discard fuzzy Chinese echoes while Mia audio is playing"
);
assert.match(
  source.match(/const startLocalStudentSpeechSubtitles = \(\) => \{[\s\S]*?\n  \};/u)?.[0] || "",
  /if \(isCoachRemoteAudioActive\(\)\) continue/u,
  "local browser ASR subtitle mirroring must drop packets while Mia audio is active so Mia's own voice is not rendered as the student's caption"
);
assert.match(
  source,
  /hasCjkLocalTranscriptEcho[\s\S]*normalized\.length >= 3[\s\S]*coachText\.includes\(normalized\)/u,
  "student subtitle echo filtering must discard short Chinese substrings from Mia speech such as '正在镜子前'"
);
assert.match(
  source,
  /role === "student" && isLikelyCoachEchoLocalStudentTranscript\(correctedText\)[\s\S]*return/u,
  "SDK student subtitles that echo Mia's recent speech must be discarded before they enter visible history or LLM context"
);
assert.match(
  source,
  /item\.role === "student" && isLikelyCoachEchoLocalStudentTranscript\(correctedText\)[\s\S]*return/u,
  "RTS student subtitles that echo Mia's recent speech must be discarded before they enter visible history or LLM context"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /当前页没有可信原文[\s\S]*不得引用旧页、封面、上一页[\s\S]*不要说 Kipper 正在镜子前/u,
  "speaking practice must not invent cover/previous-page details when the current page has no trusted text"
);
assert.match(
  collectCoachRtsSubtitleItems,
  /recognition|recognized|transcription|translation|sourceText|targetText/u,
  "RTS subtitle collector must treat recognition/transcription fields as voice subtitles"
);
assert.doesNotMatch(
  source,
  /shadowRtcStudentReadFollowUp|学生刚刚按要求跟读/u,
  "shadow reading must not auto-send ExternalTextToLLM from student voice subtitles because that can create two coach voices"
);
assert.doesNotMatch(
  beginCoachRtcSession,
  /role === "student"[\s\S]*sendCoachRtcAgentControlMessage/u,
  "student voice subtitles must stay on the native RTC voice turn and must not trigger a second text-to-LLM turn"
);
assert.match(
  beginCoachRtcSession,
  /onRoomMessageReceived[\s\S]*handleCoachRtsSubtitleMessage[\s\S]*onUserMessageReceived[\s\S]*handleCoachRtsSubtitleMessage[\s\S]*onRoomBinaryMessageReceived[\s\S]*decodeCoachRtcBinaryMessage[\s\S]*onUserBinaryMessageReceived[\s\S]*decodeCoachRtcBinaryMessage/u,
  "storyflow RTC must listen to room/user text and binary subtitle messages like Agent mode"
);
assert.match(
  source,
  /coachSubtitleMessages[\s\S]*coachMessages[\s\S]*filter\(isVoiceSubtitleMessage\)[\s\S]*slice\(-12\)/u,
  "storyflow speaking and shadow pages must derive subtitles from student and teacher voice messages"
);
assert.match(
  storyflowStoreSource,
  /export interface StoryflowVoiceSubtitleRecord[\s\S]*role: "student" \| "coach"[\s\S]*text: string[\s\S]*createdAt: number/u,
  "storyflow records must define persisted student/teacher voice subtitles"
);
assert.match(
  storyflowStoreSource,
  /voiceSubtitles\?: StoryflowVoiceSubtitleRecord\[\]/u,
  "speaking practice records must persist voice subtitles"
);
assert.match(
  assignmentsSource,
  /voiceSubtitles\?: StoryflowVoiceSubtitleRecord\[\]/u,
  "shadow submissions must persist voice subtitles"
);
assert.match(
  source,
  /const getCoachVoiceSubtitleRecords = \(\)[\s\S]*filter\(isVoiceSubtitleMessage\)[\s\S]*createdAt/u,
  "storyflow must snapshot visible RTC subtitles before saving records"
);
assert.match(
  source,
  /coachRtcLiveTranscriptIdsRef = useRef<Record<string, \{ id: string; text: string; at: number \}>>/u,
  "storyflow live subtitles must keep text state so separate speaking-practice utterances are not overwritten"
);
assert.match(
  source,
  /coachRtcPageChangeTokenRef = useRef\(0\)/u,
  "storyflow RTC page changes must track a monotonic token so older async page-change prompts cannot overwrite the current page"
);
assert.match(
  source,
  /normalizeCoachRtcTranscriptComparisonText[\s\S]*replace\(\s*\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu[\s\S]*normalizedForCompare[\s\S]*activeForCompare[\s\S]*normalizedForCompare\.startsWith\(activeForCompare\)/u,
  "storyflow must merge growing live ASR packets even when punctuation changes, such as Be. -> Beef and."
);
assert.match(
  source,
  /mergeCoachRtcTranscriptText[\s\S]*isLikelyTranscriptContinuation[\s\S]*message\.role === "student"[\s\S]*mergeCoachRtcTranscriptText\(message\.text, normalized\)/u,
  "student subtitles must append later same-turn fragments instead of dropping shorter follow-up ASR text"
);
assert.match(
  source,
  /message\.role === "student"[\s\S]*mergeCoachRtcTranscriptText\(message\.text, normalized\)[\s\S]*message\.role === "coach"[\s\S]*mergeCoachRtcTranscriptText\(message\.text, normalized\)/u,
  "coach subtitles must also merge same-turn fragments so Mia's speech is not split into multiple bubbles"
);
assert.match(
  source,
  /const canonicalSource =[\s\S]*role === "student"[\s\S]*"student_voice"[\s\S]*"coach_voice"/u,
  "coach subtitles from SDK and RTS must share one stream key so Mia's speech is not split by transport source"
);
assert.match(
  source,
  /INCOMPLETE_STUDENT_TRANSCRIPT_ENDINGS[\s\S]*because[\s\S]*\bof\b[\s\S]*\bthat\b[\s\S]*isIncompleteStudentTranscriptEnding[\s\S]*isLikelyTranscriptContinuation/u,
  "student subtitles must keep merging when ASR pauses on incomplete endings such as because/of/that"
);
assert.doesNotMatch(
  source,
  /normalized\.startsWith\(active\.text\)|active\.text\.startsWith\(normalized\)/u,
  "storyflow live ASR comparison must not use punctuation-sensitive raw text prefixes"
);
assert.match(
  source,
  /const voiceSubtitles = getCoachVoiceSubtitleRecords\(\)[\s\S]*shadowSubmission:[\s\S]*voiceSubtitles/u,
  "shadow reading submissions must save the current RTC subtitles"
);
assert.match(
  source,
  /const voiceSubtitles = getCoachVoiceSubtitleRecords\(\)[\s\S]*const record: StoryflowSpeakingPracticeRecord = \{[\s\S]*voiceSubtitles/u,
  "speaking practice records must save the current RTC subtitles"
);
assert.match(
  teacherWorkspaceSource,
  /formatVoiceSubtitleSummary[\s\S]*voiceSubtitles/u,
  "teacher workspace must render saved voice subtitles in records"
);
assert.match(
  aiCoachPanel,
  /ref=\{coachConversationScrollRef\}[\s\S]*coachSubtitleMessages\.map\(\(message\) => \{[\s\S]*const isStudent = message\.role === "student"[\s\S]*isStudent \? "我" : "Mia"/u,
  "speaking page floating panel must render agent-style student/teacher subtitles"
);
assert.match(
  shadowPageBranch,
  /ref=\{coachConversationScrollRef\}[\s\S]*coachSubtitleMessages\.map\(\(message\) => \{[\s\S]*const isStudent = message\.role === "student"[\s\S]*isStudent \? "我" : "Mia"/u,
  "shadow reading page must render agent-style student/teacher subtitles"
);
assert.doesNotMatch(
  beginCoachRtcSession,
  /text:\s*role === "student" \? `我听到：\$\{text\}` : text/u,
  "RTC student subtitles must match Agent mode and not add a local prefix"
);
assert.match(
  stopCoachRtcAgentSession,
  /\/api\/agent-rtc\/stop[\s\S]*stopAudioCapture[\s\S]*leaveRoom[\s\S]*safeDestroyCoachRtcEngine/u,
  "storyflow RTC stop must stop the active VoiceChat task and clean the RTC engine"
);
assert.doesNotMatch(
  safeDestroyCoachRtcEngine,
  /engine\.destroy\?\.\(\)|\.destroy\(/u,
  "storyflow RTC cleanup must not call RTC SDK destroy because it can surface a disconnect runtime error during shadow teardown"
);
assert.match(
  notifyCoachRtcPageChanged,
  /interruptCoachRtcOutput\(\)[\s\S]*drawCoachRtcVisualFrame[\s\S]*resolvedTaskMode === "shadow"[\s\S]*return[\s\S]*sendCoachRtcAgentControlMessage/u,
  "storyflow page changes must interrupt and redraw the visual frame; only speaking mode may notify Mia to speak"
);
assert.match(
  notifyCoachRtcPageChanged,
  /const pageChangeContextPrompt = \[[\s\S]*当前唯一有效页[\s\S]*旧页、封面、上一页[\s\S]*sendCoachRtcAgentContextPrompt\(pageChangeContextPrompt\)[\s\S]*sendCoachRtcAgentControlMessage/u,
  "storyflow page changes must silently replace the RTC lesson context before prompting Mia to speak, so old cover/page state cannot leak after turning pages"
);
assert.match(
  notifyCoachRtcPageChanged,
  /const pageChangeToken = \+\+coachRtcPageChangeTokenRef\.current[\s\S]*const isStalePageChange = \(\)[\s\S]*pageChangeToken !== coachRtcPageChangeTokenRef\.current[\s\S]*if \(isStalePageChange\(\)\) return/u,
  "storyflow page-change sync must ignore stale async notifications from previously visible pages"
);
assert.match(
  notifyCoachRtcPageChanged,
  /看图说话[\s\S]*只围绕当前唯一有效页[\s\S]*清空上一页目标词[\s\S]*不要继续讲封面/u,
  "speaking page-change prompts must force Mia to discard old title/cover targets such as Spots after the student turns to a later page"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /【看图说话RTC练习】[\s\S]*当前页可信原文/u,
  "storyflow RTC prompt must preserve speaking-practice behavior instead of full page lecture"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /不要一开始直接朗读或泄露完整原文/u,
  "storyflow RTC prompt must preserve speaking-practice behavior instead of full page lecture"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /只提示孩子说出当前页原文句子[\s\S]*不要提和原文无关的问题/u,
  "storyflow RTC prompt must keep speaking practice focused on recalling source sentences"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /看图说话[\s\S]*禁止用中文谐音标注英文发音[\s\S]*不要把英文单词拆成中文近似音[\s\S]*不要让孩子一个字母一个字母拼读/u,
  "speaking practice must not teach English pronunciation with Chinese homophones or letter-by-letter spelling"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /Spots[\s\S]*Sports[\s\S]*按 Spots 理解[\s\S]*不要反复说孩子错/u,
  "speaking practice must treat ASR Sports as Spots when the trusted page text is Spots"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /学生已经说出当前目标词或目标句[\s\S]*不要说“没关系”[\s\S]*不要要求重读[\s\S]*直接认可并推进/u,
  "speaking practice must not ask the student to reread after the target word or sentence has been recognized"
);
assert.match(
  rtcAgentSource,
  /禁止用中文谐音标注英文发音[\s\S]*不要把英文单词拆成中文近似音/u,
  "shared RTC agent prompt must forbid Chinese homophone pronunciation labels"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /影子跟读规则[\s\S]*只针对孩子朗读句子和单词的发音、流畅度、准确度以及读错的地方进行指导[\s\S]*纠错最多连续 3 次[\s\S]*鼓励孩子一下，然后继续往后/u,
  "shadow RTC prompt must behave as a pronunciation coach and move on after at most three corrections"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /发音判断标准默认宽松[\s\S]*80%[\s\S]*可通过[\s\S]*只纠正 1 个最影响理解的问题[\s\S]*不要因为口音、轻微音调/u,
  "shadow RTC pronunciation standard must be child-friendly: pass around 80%, correct only the most meaning-impacting issue, and tolerate accent/minor intonation"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /当前影子跟读允许句子[\s\S]*只允许要求学生朗读“当前影子跟读允许句子”里的原句[\s\S]*如果想让学生重读，必须逐字引用允许句子里的其中一句/u,
  "shadow RTC prompt must lock the coach to the current visible shadow-reading sentence list"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /禁止要求学生读任何不在允许句子清单里的句子/u,
  "shadow RTC prompt must forbid asking the student to read stale or nonexistent sentences"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /清单外词[\s\S]*不能围绕这个清单外词纠音[\s\S]*children/u,
  "shadow RTC prompt must not correct words that are not in the current allowed sentence list"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /同一次回复[\s\S]*禁止反复自我否定[\s\S]*对、不对、哦不对/u,
  "shadow RTC prompt must prevent contradictory repeated judgement in a single reply"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /具体指出读错的单词[\s\S]*哪个音节或哪个单个音[\s\S]*口型、舌位、长短音、清浊音[\s\S]*重音位置[\s\S]*发音规则/u,
  "shadow RTC pronunciation corrections must explain the specific word, syllable/sound problem, how to produce the sound, stress, and rule"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /学生读错[\s\S]*先再读一遍正确读法[\s\S]*再解释发音规则[\s\S]*请孩子重读[\s\S]*解释发音规则最多 1 遍[\s\S]*再次犯错[\s\S]*只示范正确发音/u,
  "shadow RTC pronunciation corrections must model the correct pronunciation, explain the rule at most once, and only model again on repeated mistakes"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /ASR[\s\S]*Biff[\s\S]*beef[\s\S]*Kipper[\s\S]*keeper[\s\S]*Floppy[\s\S]*Lopi[\s\S]*Lucky[\s\S]*不要因为字幕显示/u,
  "shadow RTC prompt must handle common character-name ASR confusions without repeated false corrections"
);
assert.ok(
  ["aiCoachPageText", "Biff", "beef", "Kipper", "keeper", "Floppy", "lopi", "lucky", "Spots", "Sports"].every(
    (token) => correctCoachRtcTranscriptAgainstCurrentText.includes(token)
  ),
  "student subtitles must correct common ASR confusion like beef -> Biff, keeper -> Kipper, Lopi/Lucky -> Floppy, and Sports -> Spots when the current trusted text contains those names"
);
assert.match(
  rtcAgentSource,
  /const isShadowRtcLessonState[\s\S]*任务模式：影子跟读/u,
  "RTC agent config must detect shadow-reading lesson state"
);
assert.match(
  rtcAgentSource,
  /HistoryLength:\s*isShadowRtcLessonState\(session\.lessonState \|\| ""\) \? 1 : 10/u,
  "shadow-reading RTC must use a short LLM history so stale words from earlier pages cannot drive corrections"
);
assert.match(
  source,
  /const correctedText =[\s\S]*correctCoachRtcTranscriptAgainstCurrentText\(text\)[\s\S]*text: correctedText/u,
  "RTC subtitle handlers must store corrected student transcript text in the visible subtitle history"
);
assert.match(
  source,
  /const canonicalSource = role === "student" \? "student_voice" : "coach_voice"[\s\S]*const streamKey = `\$\{canonicalSource\}_\$\{role\}`/u,
  "student and coach subtitles from SDK and RTS must share stable stream keys so the same utterance is not rendered twice"
);
assert.match(
  source,
  /const isSameActiveCoachContinuation[\s\S]*role === "coach"[\s\S]*isLikelyTranscriptContinuation\(active\.text, normalized\)[\s\S]*isSameActiveCoachContinuation/u,
  "coach subtitle fragments from the same spoken turn must keep updating the current Mia bubble"
);
assert.match(
  source,
  /const isSameCoachContinuation[\s\S]*role === "coach"[\s\S]*isLikelyTranscriptContinuation\(recent\.text, normalized\)[\s\S]*isSameCoachContinuation/u,
  "coach subtitle fragments finalized in adjacent packets must merge into one Mia bubble"
);
assert.match(
  source,
  /const isSameStudentRewrite[\s\S]*role === "student"[\s\S]*now - recent\.at < 4500[\s\S]*isSameGrowingUtterance[\s\S]*isSameStudentRewrite/u,
  "student ASR rewrites in the same short voice turn must merge even when the recognized words change completely"
);
assert.match(
  source,
  /const activeMergedText =[\s\S]*mergeCoachRtcTranscriptText\(active\.text, normalized\)[\s\S]*text: activeMergedText/u,
  "student long utterance subtitles must accumulate active ASR fragments instead of keeping only the longest fragment"
);
assert.match(
  source,
  /const recentMergedText =[\s\S]*mergeCoachRtcTranscriptText\(recent\.text, normalized\)[\s\S]*text: recentMergedText/u,
  "student long utterance subtitles must accumulate recent ASR fragments instead of dropping the beginning"
);
assert.match(
  source,
  /const text = normalizeAiContextText\(result\?\.\[0\]\?\.transcript \|\| "", 1200\)/u,
  "local student subtitle mirror must keep long speaking-practice utterances instead of truncating them to a short fragment"
);
assert.match(
  source,
  /const directOverlap = findCoachRtcTranscriptWordOverlap\(currentWords, nextWords\)[\s\S]*return normalizeStoryText\(\[current, nextWords\.slice\(directOverlap\)\.join\(" "\)\]/u,
  "RTC subtitle merge must preserve the beginning of long student sentences when later ASR packets contain the continuation"
);
assert.match(
  source,
  /function isLikelyCoachRtcTranscriptRewrite[\s\S]*matchedTokenCount[\s\S]*return coverage >= 0\.72[\s\S]*if \(isLikelyCoachRtcTranscriptRewrite\(currentWords, nextWords\)\) \{[\s\S]*return next\.length >= current\.length \? next : current/u,
  "RTC subtitle merge must not duplicate one spoken sentence when ASR rewrites a word such as put -> puts"
);
assert.match(
  beginCoachRtcSession,
  /const correctedText =[\s\S]*item\.role === "student"[\s\S]*correctCoachRtcTranscriptAgainstCurrentText\(item\.text\)[\s\S]*source: `rts_/u,
  "RTS student subtitles must also be corrected against the current trusted text"
);
assert.doesNotMatch(
  source,
  /图中的影子是什么|三个小朋友在看什么|接下来会发生什么|哪里可以更好|重点词是什么|帮我判断能不能翻到下一页/u,
  "speaking-practice quick prompts must not ask open-ended questions unrelated to the source sentence"
);
assert.doesNotMatch(
  source,
  /这本绘本的重点单词是什么|这本绘本的重点句型是什么|根据我的跟读给我一个等级/u,
  "shadow quick prompts must stay focused on pronunciation, fluency, accuracy, and corrections"
);
assert.match(
  rtcAgentSource,
  /看图说话RTC练习[\s\S]*覆盖默认两轮陪学流程/u,
  "shared RTC agent system prompt must let storyflow speaking-practice state override AgentStudy lesson flow"
);
assert.match(
  rtcAgentSource,
  /s-p-o-r-t-s[\s\S]*只读字母[\s\S]*不要读.*(?:连字符|横杠|减号)/u,
  "shared RTC agent voice prompt must prevent hyphenated spelling such as s-p-o-r-t-s from being read as minus signs"
);
assert.doesNotMatch(
  source,
  /已切换普通语音模式/u,
  "storyflow realtime voice must not silently fall back to the old realtime voice mode"
);
assert.match(
  askAiCoach,
  /!coachRtcStartedRef\.current[\s\S]*return[\s\S]*sendCoachRtcAgentControlMessage/u,
  "speaking/shadow text prompts must require RTC and send through the RTC agent control channel"
);
assert.doesNotMatch(
  askAiCoach,
  /\/api\/storyflow\/doubao|playCoachAudioReply|audioDataUrl|audioPcmBase64|hasAudioInput|scheduleCoachListening/u,
  "RTC sessions must not play local HTTP audio replies on top of the RTC agent voice"
);

console.log("Storyflow speaking realtime voice uses the RTC agent structure.");
