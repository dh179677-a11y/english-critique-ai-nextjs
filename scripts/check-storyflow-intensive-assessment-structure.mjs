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

const taskModeMeta =
  playerSource.match(/const TASK_MODE_META:[\s\S]*?= \[([\s\S]*?)\];/u)?.[1] || "";
const assessmentCards =
  playerSource.match(/const assessmentCards = \[([\s\S]*?)\];/u)?.[1] || "";
const buildCoachRtcWelcomeMessage =
  playerSource.match(/const buildCoachRtcWelcomeMessage = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const buildCoachRtcLessonStatePrompt =
  playerSource.match(/const buildCoachRtcLessonStatePrompt = \(\) => \{([\s\S]*?)\n  \};/u)?.[1] || "";
const aiCoachPanel =
  playerSource.slice(
    playerSource.indexOf("const aiCoachPanel ="),
    playerSource.indexOf("const stopShadowAudioPlayback", playerSource.indexOf("const aiCoachPanel ="))
  );
const overviewTaskCardMeta =
  playerSource.match(/const overviewTaskCardMeta:[\s\S]*?= \{([\s\S]*?)\n    \};/u)?.[1] || "";

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
  playerSource,
  /agentLessonFlowPrompt[\s\S]*formatAgentLessonStatePrompt[\s\S]*type AgentLessonStep/u,
  "student 绘本精讲 must import Agent lesson flow primitives"
);
assert.match(
  playerSource,
  /const \[intensiveLessonStep,\s*setIntensiveLessonStep\] = useState<AgentLessonStep>\("intro"\)/u,
  "student 绘本精讲 must keep the same lesson step state as Agent mode"
);
assert.match(
  playerSource,
  /const buildIntensiveLessonState = [\s\S]*round1_picture[\s\S]*round2_student_read/u,
  "student 绘本精讲 must build progress-aware Agent lesson state"
);
assert.match(
  playerSource,
  /advanceIntensiveLessonStepFromSubtitle[\s\S]*round1_picture[\s\S]*round1_read[\s\S]*round2_student_read[\s\S]*round2_feedback/u,
  "student 绘本精讲 must advance lesson steps from student and Mia subtitles"
);
assert.match(
  buildCoachRtcLessonStatePrompt,
  /formatAgentLessonStatePrompt\(buildIntensiveLessonState\(\)\)[\s\S]*agentLessonFlowPrompt/u,
  "绘本精讲 RTC lesson state must embed Agent two-round lesson flow and current step"
);
assert.match(
  playerSource,
  /notifyCoachRtcPageChanged[\s\S]*resolvedTaskMode === "intensive"[\s\S]*updateIntensiveLessonStep\("round1_picture"\)[\s\S]*formatAgentLessonStatePrompt\(buildIntensiveLessonState\("round1_picture"\)\)/u,
  "绘本精讲 page turns must reset to Agent round1_picture and notify the active RTC agent"
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
