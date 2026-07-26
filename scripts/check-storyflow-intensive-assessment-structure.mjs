import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const playerSource = await readFile(
  new URL("../components/student/StoryflowTaskPlayer.tsx", import.meta.url),
  "utf8"
);
const modeRouteSource = await readFile(
  new URL("../app/tasks/[id]/[mode]/page.tsx", import.meta.url),
  "utf8"
);
const assignmentsSource = await readFile(
  new URL("../lib/storyflowAssignments.ts", import.meta.url),
  "utf8"
);
const teacherSource = await readFile(
  new URL("../components/teacher/StoryflowWorkspace.tsx", import.meta.url),
  "utf8"
);
const agentLessonFlowSource = await readFile(
  new URL("../lib/agentLessonFlow.ts", import.meta.url),
  "utf8"
);
const rtcAgentSource = await readFile(
  new URL("../lib/volcRtcAgent.ts", import.meta.url),
  "utf8"
);

const taskModeMeta =
  playerSource.match(/const TASK_MODE_META:[\s\S]*?= \[([\s\S]*?)\];/u)?.[1] || "";
const assessmentCards =
  playerSource.match(/const assessmentCards = \[([\s\S]*?)\];/u)?.[1] || "";
const buildCoachRtcWelcomeMessage =
  playerSource.match(/const buildCoachRtcWelcomeMessage = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const buildCoachRtcLessonStatePrompt =
  playerSource.match(/const buildCoachRtcLessonStatePrompt = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const intensiveModeRules =
  buildCoachRtcLessonStatePrompt.match(
    /resolvedTaskMode === "intensive"[\s\S]*?\? \[([\s\S]*?)\n          \]\n        : resolvedTaskMode === "speaking"/u
  )?.[1] || "";
const aiCoachPanel =
  playerSource.slice(
    playerSource.indexOf("const aiCoachPanel ="),
    playerSource.indexOf("const stopShadowAudioPlayback", playerSource.indexOf("const aiCoachPanel ="))
  );
const overviewTaskCardMeta =
  playerSource.match(/const overviewTaskCardMeta:[\s\S]*?= \{([\s\S]*?)\n    \};/u)?.[1] || "";

assert.match(
  agentLessonFlowSource,
  /export const intensiveLanguageTeachingFlowPrompt[\s\S]*重点单词[\s\S]*词性[\s\S]*常见搭配[\s\S]*重点句[\s\S]*儿童习得方式[\s\S]*短例句或替换应用/u,
  "intensive teaching must focus on vocabulary and child-friendly language application"
);
assert.match(
  agentLessonFlowSource,
  /同一词族在前页已经精讲[\s\S]*最多一句简短回顾[\s\S]*禁止重复词性、完整词义列表、常见搭配、发音拆解和生活例句/u,
  "intensive prompt must forbid repeated full vocabulary explanations"
);
assert.match(
  playerSource,
  /buildPreviouslyTaughtVocabulary[\s\S]*formatPreviouslyTaughtVocabularyPrompt/u,
  "student intensive RTC must build vocabulary memory from prior pages"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /intensiveVocabularyMemoryPrompt/u,
  "shared intensive RTC lesson state must include vocabulary memory"
);
assert.match(
  playerSource,
  /continueIntensiveAfterReconnectWelcome[\s\S]*buildCoachRtcLessonStatePrompt/u,
  "reconnect continuation must reuse lesson state containing vocabulary memory"
);
assert.match(
  playerSource,
  /notifyCoachRtcPageChanged[\s\S]*buildCoachRtcLessonStatePrompt/u,
  "page changes must reuse lesson state containing vocabulary memory"
);
assert.match(
  agentLessonFlowSource,
  /当前英文原文、当前画面和故事情境共同确定[\s\S]*spots[\s\S]*(皮肤上的红疹|疹子)/u,
  "intensive vocabulary explanations must use the current story context"
);
assert.match(
  agentLessonFlowSource,
  /每个可见跨页最多提出一个问题[\s\S]*禁止要求学生跟读、朗读或练习发音[\s\S]*禁止让学生自由描述画面/u,
  "intensive teaching must reduce questions and remove pronunciation practice"
);
assert.match(
  rtcAgentSource,
  /isIntensiveLanguageTeachingState[\s\S]*isIntensiveLanguageTeachingState\(lessonState\)[\s\S]*intensiveLanguageTeachingFlowPrompt[\s\S]*agentLessonFlowPrompt/u,
  "RTC intensive sessions must replace the generic two-round lesson flow"
);
assert.match(
  rtcAgentSource,
  /isIntensiveLanguageTeachingState\(lessonState\)[\s\S]*开场后直接进入当前页语言知识讲解[\s\S]*说明今天分两遍学习/u,
  "RTC intensive sessions must override the generic two-round opening constraint"
);
assert.match(
  rtcAgentSource,
  /isIntensiveLanguageTeachingState\(lessonState\)[\s\S]*整个跨页最多一个原文问题[\s\S]*每一侧页都要原文为主/u,
  "RTC intensive sessions must override per-side interactions and follow-reading"
);

assert.ok(taskModeMeta, "TASK_MODE_META was not found");
assert.match(
  playerSource,
  /type TaskMode = "animation" \| "intensive" \| "shadow" \| "speaking" \| "assessment"/u,
  "student Storyflow modes must expose animation, intensive reading, shadow, speaking, and assessment only"
);
assert.doesNotMatch(
  playerSource,
  /TaskMode = [^\n]*"performance"|key:\s*"performance"|label:\s*"整本复述"/u,
  "student overview must remove the old whole-book retelling module"
);
assert.match(
  taskModeMeta,
  /key:\s*"animation"[\s\S]*key:\s*"intensive"[\s\S]*label:\s*"绘本精讲"[\s\S]*key:\s*"shadow"[\s\S]*key:\s*"speaking"[\s\S]*key:\s*"assessment"/u,
  "student overview cards must put 绘本精讲 after 动画伴读 and before 影子跟读"
);
assert.match(
  overviewTaskCardMeta,
  /intensive:[\s\S]*badgeClass[\s\S]*dotClass[\s\S]*ringClass/u,
  "student overview must style the 绘本精讲 card"
);
assert.match(
  modeRouteSource,
  /"intensive"/u,
  "task mode route must allow the 绘本精讲 module"
);
assert.match(
  assignmentsSource,
  /"animation"[\s\S]*"intensive"[\s\S]*"shadow"[\s\S]*"speaking"[\s\S]*"assessment"/u,
  "published assignment modules must include 绘本精讲 after animation"
);
assert.doesNotMatch(
  assignmentsSource,
  /"performance"/u,
  "new published assignment modules must not include whole-book retelling"
);
assert.match(
  teacherSource,
  /type TabKey = "animation" \| "intensive" \| "shadow" \| "speaking" \| "feedback"/u,
  "teacher Storyflow workspace must expose a 绘本精讲 tab"
);
assert.match(
  teacherSource,
  /STORYFLOW_MODULE_LABELS[\s\S]*intensive:\s*"绘本精讲"/u,
  "teacher publish module labels must include 绘本精讲"
);
assert.doesNotMatch(
  teacherSource,
  /TabButton[\s\S]*整本复述|activeTab === "performance"|setActiveTab\("performance"\)/u,
  "teacher Storyflow workspace must remove the whole-book retelling tab"
);
assert.match(
  buildCoachRtcWelcomeMessage,
  /resolvedTaskMode === "intensive"[\s\S]*绘本精讲/u,
  "RTC welcome must have a dedicated 绘本精讲 opening"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /resolvedTaskMode === "intensive"[\s\S]*绘本精讲规则[\s\S]*当前屏幕画面[\s\S]*当前页可信原文/u,
  "RTC lesson state must send intensive reading rules without student-facing Agent wording"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /resolvedTaskMode === "intensive"[\s\S]*intensiveLanguageTeachingFlowPrompt[\s\S]*当前页分栏原文/u,
  "Storyflow intensive context must use the language teaching flow"
);
assert.match(
  playerSource,
  /const intensivePageTextParts = splitDualPageText\(page\?\.visibleText \|\| ""\)/u,
  "intensive page text must split the persisted left and right page source"
);
assert.match(
  playerSource,
  /isIntensiveMode[\s\S]*intensivePageTextParts\.rightText[\s\S]*Left Page[\s\S]*Right Page[\s\S]*Page Text/u,
  "intensive page text must render dual-page cards and retain the single-page fallback"
);
assert.doesNotMatch(
  intensiveModeRules,
  /第二轮|自主朗读|按发音准确度|朗读流畅度|语调和完整度|要求学生跟读/u,
  "Storyflow intensive mode must not retain pronunciation or rereading steps"
);
assert.match(
  buildCoachRtcWelcomeMessage,
  /我们开始绘本精讲。今天重点学习原文里的单词、语法和句型应用。我会结合画面讲清楚用法。现在先听我讲当前页。/u,
  "the intensive welcome must use the approved concise copy"
);
assert.match(
  playerSource,
  /shouldResumeIntensiveAfterReconnectRef[\s\S]*continueIntensiveAfterReconnectWelcome[\s\S]*我们继续刚才的学习[\s\S]*sendCoachRtcAgentControlMessage[\s\S]*重连后立即继续当前页精讲/u,
  "intensive RTC reconnect must automatically continue teaching after the reconnect welcome"
);
assert.match(
  playerSource,
  /resolvedTaskMode === "intensive"[\s\S]*hasIntroducedIntensiveRtcRulesRef\.current[\s\S]*shouldResumeIntensiveAfterReconnectRef\.current/u,
  "intensive RTC start must arm auto-resume only for a resumed lesson"
);
assert.doesNotMatch(
  buildCoachRtcWelcomeMessage,
  /不要求学生跟读|重点单词、语法和重点句/u,
  "the intensive welcome must not repeat 重点 or expose internal follow-reading rules"
);
assert.match(
  agentLessonFlowSource,
  /每个可见跨页最多讲一个最有用的语言规律[\s\S]*一到两个短例句或替换应用[\s\S]*禁止讲主谓宾、宾语补足语、时态定义、动词变位表/u,
  "intensive grammar teaching must use child-friendly acquisition"
);
assert.doesNotMatch(
  playerSource,
  /intensiveLessonStep|buildIntensiveLessonState|advanceIntensiveLessonStepFromSubtitle/u,
  "student 绘本精讲 must remove the old two-round pronunciation state machine"
);
assert.match(
  playerSource,
  /notifyCoachRtcPageChanged[\s\S]*resolvedTaskMode === "intensive"[\s\S]*intensiveLanguageTeachingFlowPrompt[\s\S]*整个跨页最多问一个[\s\S]*不要要求学生跟读、朗读或练习发音/u,
  "绘本精讲 page turns must continue the language teaching flow without reading practice"
);
assert.match(
  playerSource,
  /previousPageText:\s*resolvedTaskMode === "speaking"[\s\S]*nextPageText:\s*resolvedTaskMode === "speaking"/u,
  "绘本精讲 current-page narration must not expose previous or next page text as factual evidence"
);
assert.match(
  aiCoachPanel,
  /resolvedTaskMode === "shadow" \|\| resolvedTaskMode === "speaking" \|\| resolvedTaskMode === "intensive"/u,
  "the realtime voice panel must be available in 绘本精讲"
);
assert.match(
  playerSource,
  /resolvedTaskMode === "intensive"[\s\S]*Mia 精讲[\s\S]*实时字幕[\s\S]*实时语音/u,
  "student 绘本精讲 page must render realtime voice and subtitle history"
);
assert.match(
  assessmentCards,
  /practiceRecords[\s\S]*voiceSubtitles[\s\S]*问题记录/u,
  "student score feedback must summarize practice records, subtitles, and problem records"
);
assert.doesNotMatch(
  assessmentCards,
  /脱稿表演|performance/u,
  "student score feedback must focus on shadow reading and speaking practice"
);
assert.match(
  teacherSource,
  /const joinDualPageText = \([\s\S]*leftText: string,[\s\S]*rightText: string,[\s\S]*options\?: \{ preserveRightSlot\?: boolean \}[\s\S]*preserveRightSlot[\s\S]*\[RIGHT_PAGE\]/u,
  "teacher page editor must be able to preserve an empty right-page slot so right-page typing is not collapsed into single text"
);
assert.match(
  teacherSource,
  /const \[isDraftTextDirty,\s*setIsDraftTextDirty\] = useState\(false\)[\s\S]*setDraftTexts\(\(current\) => \{[\s\S]*if \(isDraftTextDirty\) return current/u,
  "teacher page editor must not reset draft text from the saved document while the teacher is typing"
);
assert.match(
  teacherSource,
  /const PAGE_TEXT_AUTO_SAVE_INTERVAL_MS = 20_000/u,
  "teacher page editor must define a 20-second text autosave interval"
);
assert.match(
  teacherSource,
  /useEffect\(\(\) => \{[\s\S]*if \(!isDraftTextDirty\) return undefined[\s\S]*window\.setInterval\(\(\) => \{[\s\S]*onSaveAllPageTexts\(draftTextsRef\.current, \{ silent: true \}\)[\s\S]*setIsDraftTextDirty\(false\)[\s\S]*PAGE_TEXT_AUTO_SAVE_INTERVAL_MS[\s\S]*window\.clearInterval\(autoSaveTimer\)/u,
  "teacher page editor must autosave dirty page text drafts every 20 seconds and stop the timer cleanly"
);
assert.match(
  teacherSource,
  /const handleSaveAllPageTexts = \(texts: string\[\], options\?: \{ silent\?: boolean \}\)[\s\S]*if \(!options\?\.silent\) \{[\s\S]*setNotice\("全部页面文字已保存。"\)/u,
  "teacher text autosave must be silent while manual save still shows the saved notice"
);
const handleSavePageText =
  teacherSource.match(/const handleSavePageText = \(pageIndex: number, text: string\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const handleSaveAllPageTexts =
  teacherSource.match(/const handleSaveAllPageTexts = \(texts: string\[\], options\?: \{ silent\?: boolean \}\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
assert.match(
  handleSavePageText,
  /nextTexts\[pageIndex\] = text\.trim\(\)/u,
  "saving one page text must only replace the current page text slot"
);
assert.doesNotMatch(
  handleSavePageText,
  /\.splice\(|\.filter\(/u,
  "saving one page text must not delete or shift neighboring page texts"
);
assert.doesNotMatch(
  handleSavePageText,
  /shadowAudio:\s*preserveExistingAudioMapping/u,
  "saving one page text must not rewrite audio timeline mappings"
);
assert.doesNotMatch(
  handleSaveAllPageTexts,
  /shadowAudio:\s*preserveExistingAudioMapping/u,
  "saving all page text or autosaving text must not rewrite audio timeline mappings"
);
assert.match(
  teacherSource,
  /const AUTO_NEXT_AUDIO_START_GAP_SEC = 5/u,
  "next audio timeline draft must start 5 seconds after the saved segment"
);
assert.match(
  teacherSource,
  /onClick=\{\(\) => \{[\s\S]*onSaveAudioMapping\(pageIndex, slot, trackIndex, start, end\)[\s\S]*setDraftAudioMap\(\(current\) =>[\s\S]*applyAutoNextAudioStart\([\s\S]*pageIndex,[\s\S]*slot,[\s\S]*trackIndex,[\s\S]*end/u,
  "saving an audio timeline segment must prepare the next unset segment 5 seconds later"
);
assert.match(
  teacherSource,
  /const updateDraftDualPageTextSlot = \([\s\S]*slot: "left" \| "right"[\s\S]*splitDualPageText\(currentText\)[\s\S]*joinDualPageText\([\s\S]*preserveRightSlot: true/u,
  "teacher page editor must update only the edited left/right text slot and preserve empty opposite slots"
);
assert.match(
  teacherSource,
  /next\[pageIndex\] = updateDraftDualPageTextSlot\([\s\S]*draftTexts\[pageIndex\][\s\S]*"left"[\s\S]*event\.target\.value[\s\S]*setIsDraftTextDirty\(true\)[\s\S]*next\[pageIndex\] = updateDraftDualPageTextSlot\([\s\S]*draftTexts\[pageIndex\][\s\S]*"right"[\s\S]*event\.target\.value[\s\S]*setIsDraftTextDirty\(true\)/u,
  "teacher left/right textareas must edit their own slot without rewriting adjacent page text"
);
assert.match(
  teacherSource,
  /return joinDualPageText\(leftText, nextSlotText, \{ preserveRightSlot: true \}\)/u,
  "teacher page editor right-page slot updates must keep the dual-page marker even when one side is empty"
);
assert.match(
  teacherSource,
  /保存右页/u,
  "teacher page editor should label the right-page save action clearly"
);

console.log("Storyflow intensive reading and score feedback structure is wired.");
