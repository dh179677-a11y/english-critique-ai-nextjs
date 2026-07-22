import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../components/student/AgentStudyClient.tsx", import.meta.url),
  "utf8"
);
const storyflowSource = await readFile(
  new URL("../components/student/StoryflowTaskPlayer.tsx", import.meta.url),
  "utf8"
);
const rtcAgentSource = await readFile(
  new URL("../lib/volcRtcAgent.ts", import.meta.url),
  "utf8"
);
const goToPage = source.match(/const goToPage = \(nextIndex: number\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const refreshRtcPageAfterTurn =
  source.match(
    /const refreshRtcPageAfterTurn = async \([\s\S]*?\n  \) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const notifyRtcAgentPageChanged =
  source.match(
    /const notifyRtcAgentPageChanged = async \([\s\S]*?\n  \) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const markRtcCoachResponseReceived =
  source.match(
    /const markRtcCoachResponseReceived = \(text: string, definite\?: boolean\) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const collectRtsSubtitleItems =
  source.match(
    /const collectRtsSubtitleItems = \([\s\S]*?\n  \): Array<\{ role: AgentMessage\["role"\]; text: string; sequence: string; definite: boolean \}> => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const sendRtcAgentControlMessage =
  source.match(
    /const sendRtcAgentControlMessage = async \(message: string\) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const beginRtcAgentSession =
  source.match(
    /const beginRtcAgentSession = async \(\) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const buildRtcAgentResumeWelcomeMessage =
  source.match(
    /const buildRtcAgentResumeWelcomeMessage = \(\) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const buildRtcAgentSessionLessonStatePrompt =
  source.match(
    /const buildRtcAgentSessionLessonStatePrompt = \(\) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const startRtcVisualTrack =
  source.match(/const startRtcVisualTrack = async \([\s\S]*?\n  \) => \{([\s\S]*?)\n  \};/u)
    ?.[1] || "";
const startCoachRtcVisualTrack =
  storyflowSource.match(
    /const startCoachRtcVisualTrack = async \([\s\S]*?\n  \) => \{([\s\S]*?)\n  \};/u
  )?.[1] || "";
const notifyCoachRtcPageChanged =
  storyflowSource.match(/const notifyCoachRtcPageChanged = async \(\) => \{([\s\S]*?)\n  \};/u)
    ?.[1] || "";

assert.ok(goToPage, "goToPage implementation was not found");
assert.match(
  goToPage,
  /refreshRtcPageAfterTurn\(safeIndex, page, nextLessonStep\)/u,
  "page turns must refresh the existing RTC visual track and notify the same agent"
);
assert.doesNotMatch(
  goToPage,
  /startPageTurnLecture/u,
  "page turns must not switch to the standalone TTS lecture path"
);
assert.ok(refreshRtcPageAfterTurn, "refreshRtcPageAfterTurn implementation was not found");
assert.ok(notifyRtcAgentPageChanged, "notifyRtcAgentPageChanged implementation was not found");
assert.ok(markRtcCoachResponseReceived, "markRtcCoachResponseReceived implementation was not found");
assert.ok(collectRtsSubtitleItems, "collectRtsSubtitleItems implementation was not found");
assert.ok(beginRtcAgentSession, "beginRtcAgentSession implementation was not found");
assert.ok(buildRtcAgentResumeWelcomeMessage, "buildRtcAgentResumeWelcomeMessage implementation was not found");
assert.ok(
  buildRtcAgentSessionLessonStatePrompt,
  "buildRtcAgentSessionLessonStatePrompt implementation was not found"
);
assert.ok(startRtcVisualTrack, "AgentStudy startRtcVisualTrack implementation was not found");
assert.ok(startCoachRtcVisualTrack, "Storyflow startCoachRtcVisualTrack implementation was not found");
assert.ok(notifyCoachRtcPageChanged, "Storyflow notifyCoachRtcPageChanged implementation was not found");
assert.match(
  startRtcVisualTrack,
  /captureStream\(2\)[\s\S]*setExternalVideoTrack/u,
  "AgentStudy RTC visual track must still publish the current-page canvas stream"
);
assert.doesNotMatch(
  startRtcVisualTrack,
  /setInterval|rtcVisualFrameTimerRef/u,
  "AgentStudy RTC visual track must not continuously redraw; it should refresh only on start and page turn"
);
assert.match(
  startCoachRtcVisualTrack,
  /captureStream\(2\)[\s\S]*setExternalVideoTrack/u,
  "Storyflow RTC visual track must still publish the current-page canvas stream"
);
assert.doesNotMatch(
  startCoachRtcVisualTrack,
  /setInterval|coachRtcVisualFrameTimerRef/u,
  "Storyflow RTC visual track must not continuously redraw; it should refresh only on start and page turn"
);
assert.match(
  notifyCoachRtcPageChanged,
  /drawCoachRtcVisualFrame[\s\S]*requestFrame/u,
  "Storyflow page turns must redraw and request a fresh RTC visual frame"
);
assert.match(
  refreshRtcPageAfterTurn,
  /\/api\/agent-rtc\/interrupt/u,
  "page turns must interrupt the current RTC agent output"
);
assert.match(
  refreshRtcPageAfterTurn,
  /drawRtcVisualFrame/u,
  "page turns must redraw the RTC visual track"
);
assert.match(
  refreshRtcPageAfterTurn,
  /notifyRtcAgentPageChanged/u,
  "page turns must notify the same RTC agent after the new frame is ready"
);
assert.ok(sendRtcAgentControlMessage, "sendRtcAgentControlMessage implementation was not found");
assert.match(
  sendRtcAgentControlMessage,
  /\/api\/agent-rtc\/external-text-to-llm/u,
  "RTC follow-up prompts must be sent to the active VoiceChat task through UpdateVoiceChat"
);
assert.doesNotMatch(
  sendRtcAgentControlMessage,
  /sendUserMessage|sendRoomMessage/u,
  "RTC follow-up prompts must not use SDK chat messages that do not trigger the agent to speak"
);
assert.ok(
  refreshRtcPageAfterTurn.indexOf("/api/agent-rtc/interrupt") <
    refreshRtcPageAfterTurn.indexOf("drawRtcVisualFrame"),
  "RTC output must be interrupted before the new page is drawn"
);
assert.ok(
  refreshRtcPageAfterTurn.indexOf("drawRtcVisualFrame") <
    refreshRtcPageAfterTurn.indexOf("notifyRtcAgentPageChanged"),
  "the new page must be drawn before the RTC agent is told to explain it"
);
assert.doesNotMatch(
  refreshRtcPageAfterTurn,
  /doubao-realtime-turn|speechSynthesis|playBrowserSpeechReply|requestCoachReplyForPage|\/api\/agent-rtc\/(?:stop|start)/u,
  "RTC page turns must not use standalone TTS, browser speech, or restart the agent task"
);
assert.doesNotMatch(
  source,
  /const startPageTurnLecture|const stopRtcAgentTaskOnly|const restartRtcAgentTaskSilently|ttsText|speechSynthesis|SpeechSynthesisUtterance|playBrowserSpeechReply/u,
  "legacy page-turn TTS and RTC restart helpers must be removed"
);
assert.match(
  rtcAgentSource,
  /Command:\s*"ExternalTextToLLM"[\s\S]*InterruptMode:\s*1/u,
  "ExternalTextToLLM must use InterruptMode 1 so Volcengine accepts the text-triggered turn"
);
assert.doesNotMatch(
  rtcAgentSource,
  /Command:\s*"ExternalTextToLLM"[\s\S]*InterruptMode:\s*0/u,
  "ExternalTextToLLM must not send InterruptMode 0"
);
assert.match(
  rtcAgentSource,
  /绘本页 8-9[\s\S]*一轮只讲一侧[\s\S]*先讲第8页\/左页[\s\S]*互动问题[\s\S]*再继续第9页\/右页/u,
  "RTC agent system prompt must split double-page spreads into one-side-at-a-time teaching with interaction before the right page"
);
assert.match(
  rtcAgentSource,
  /朗读当前页原文不受100字限制[\s\S]*必须读完整/u,
  "RTC agent system prompt must not let the short-answer limit truncate original page reading"
);
assert.match(
  rtcAgentSource,
  /逐句覆盖当前页完整原文[\s\S]*不能漏掉原文句子/u,
  "RTC agent system prompt must require complete sentence coverage when reading source text"
);
assert.match(
  rtcAgentSource,
  /Mum painted the go-kart\. Chip helped\.[\s\S]*He was good at painting\.[\s\S]*It looks brilliant![\s\S]*三句都必须读/u,
  "RTC agent system prompt must explicitly forbid selecting only one sentence from a side page"
);
assert.match(
  rtcAgentSource,
  /禁止提前讲未翻到页面的后续剧情[\s\S]*不能把上一页线索编成当前页已经发生/u,
  "RTC agent system prompt must forbid spoilers and story invention from previous page hints"
);
assert.match(
  rtcAgentSource,
  /所有英文原文[\s\S]*当前页可信原文[\s\S]*禁止使用绘本记忆/u,
  "RTC agent system prompt must forbid using memorized book text outside current trusted page text"
);
assert.match(
  rtcAgentSource,
  /Wilma's dad helped them[\s\S]*He started to make the go-kart[\s\S]*不能朗读或讲解/u,
  "RTC agent system prompt must explicitly forbid the known hallucinated page-1 sentences unless present in current text"
);
assert.match(
  source,
  /绘本页 8-9[\s\S]*一轮只讲一侧[\s\S]*先讲第8页\/左页[\s\S]*互动问题[\s\S]*再继续第9页\/右页/u,
  "page-turn prompts must explicitly tell the RTC agent to teach one spread side at a time"
);
assert.match(
  source,
  /原文为主[\s\S]*每一侧页都要有一次学生互动/u,
  "page-turn prompts must keep interactions centered on source text for every side page"
);
assert.match(
  source,
  /当前侧页的全部原文句子[\s\S]*不能只挑一句/u,
  "page-turn prompts must require every source sentence on the current side page before explanation"
);
assert.match(
  source,
  /只允许讲当前可见页和当前页原文/u,
  "page-turn prompts must limit the RTC agent to the current visible page"
);
assert.match(
  source,
  /不要把上一页的油漆未干[\s\S]*踩到红油漆/u,
  "page-turn prompts must forbid turning previous-page paint hints into invented current-page events"
);
assert.match(
  notifyRtcAgentPageChanged,
  /formatOriginalPageSegments\(page\.originalPageSegments/u,
  "RTC page-turn prompts must send structured left-page/right-page source text instead of only a merged paragraph"
);
assert.match(
  notifyRtcAgentPageChanged,
  /当前页分栏原文/u,
  "RTC page-turn prompts must label structured split-page source text"
);
assert.doesNotMatch(
  source,
  /const isLikelyCompleteCoachTurnForAutoContinue/u,
  "RTC coach subtitle completion must not keep local auto-continue guards after auto-continue is disabled"
);
assert.doesNotMatch(
  markRtcCoachResponseReceived,
  /scheduleAutoContinueIfNeeded/u,
  "coach subtitle completion must not locally trigger another RTC LLM turn without a student reply or page turn"
);
assert.doesNotMatch(
  source,
  /继续推进学习，不要停顿/u,
  "local auto-continue prompts must not push the agent forward when the student is silent and the page did not change"
);
assert.match(
  rtcAgentSource,
  /没有学生语音回复[\s\S]*没有翻页[\s\S]*停止说话/u,
  "RTC agent system prompt must stop after the current side when there is no student reply or page turn"
);
assert.doesNotMatch(
  source,
  /\}, 1800\);/u,
  "RTC auto-continue delay must be removed so silence does not trigger invented next-page narration"
);
assert.doesNotMatch(
  collectRtsSubtitleItems,
  /typeof subtitle\.final === "boolean"[\s\S]*:\s*true/u,
  "RTS subtitle items without final metadata must not default to definite=true"
);
assert.doesNotMatch(
  collectRtsSubtitleItems,
  /definite:\s*true/u,
  "RTS subtitle string fragments must not be treated as final coach turns"
);
assert.match(
  source,
  /previousPageText:\s*""/u,
  "coach request payload must not expose previous page text as factual evidence for current-page narration"
);
assert.match(
  source,
  /nextPageText:\s*""/u,
  "coach request payload must not expose next page text before the student flips there"
);
assert.doesNotMatch(
  source,
  /nextPageText:\s*getMaterialPageText/u,
  "navigation context must not expose next page text before the student flips there"
);
assert.match(
  source,
  /allPageTexts:\s*\[\]/u,
  "coach request payload must not expose the full book text for current-page narration"
);
assert.doesNotMatch(
  beginRtcAgentSession,
  /updateLessonStep\("intro"\)/u,
  "reopening realtime voice must not reset lesson progress to intro"
);
assert.match(
  beginRtcAgentSession,
  /lessonState:\s*buildRtcAgentSessionLessonStatePrompt\(\)/u,
  "reopened RTC sessions must start with current lesson state plus current trusted page text"
);
assert.match(
  buildRtcAgentSessionLessonStatePrompt,
  /formatAgentLessonStatePrompt\(buildLessonState\(\)\)/u,
  "RTC start/resume lesson state must include current lesson progress"
);
assert.match(
  buildRtcAgentSessionLessonStatePrompt,
  /当前页可信原文[\s\S]*当前页分栏原文/u,
  "RTC start/resume lesson state must label trusted current-page text"
);
assert.match(
  buildRtcAgentSessionLessonStatePrompt,
  /formatOriginalPageSegments\(page\.originalPageSegments\)/u,
  "RTC start/resume lesson state must include structured current-page trusted source text"
);
assert.match(
  buildRtcAgentSessionLessonStatePrompt,
  /禁止使用绘本记忆[\s\S]*旧页面补充/u,
  "RTC start/resume trusted page text must forbid filling current narration from memory or old pages"
);
assert.match(
  beginRtcAgentSession,
  /welcomeMessage:\s*buildRtcAgentResumeWelcomeMessage/u,
  "reopened RTC sessions must use a progress-aware continuation welcome message"
);
assert.match(
  source,
  /const buildRtcAgentResumeWelcomeMessage/u,
  "progress-aware RTC resume welcome helper must exist"
);
assert.match(
  buildRtcAgentResumeWelcomeMessage,
  /return "我们继续刚才的学习。";/u,
  "RTC resume welcome must be exactly one short continuation sentence"
);
assert.doesNotMatch(
  buildRtcAgentResumeWelcomeMessage,
  /不要重新介绍学习规则|不要回到封面|现在继续|当前步骤|请直接按照当前页/u,
  "RTC resume welcome must not speak rules, page labels, or step labels before continuing"
);

console.log("RTC page turns stay on the existing agent session.");
