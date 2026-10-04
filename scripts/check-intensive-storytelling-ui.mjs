import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const playerSource = await readFile(
  new URL("../components/student/StoryflowTaskPlayer.tsx", import.meta.url),
  "utf8"
);
const promptSource = await readFile(
  new URL("../lib/agentLessonFlow.ts", import.meta.url),
  "utf8"
);

for (const source of [playerSource, promptSource]) {
  assert.doesNotMatch(
    source,
    /这一页讲完了，我们自动进入下一页/u,
    "intensive prompts must not ask Mia to speak the page-turn announcement"
  );
}

assert.match(
  promptSource,
  /像讲故事一样/u,
  "intensive teaching prompt must explicitly use a story-like narration style"
);
assert.match(
  promptSource,
  /自然穿插当前页英文原句/u,
  "story-like narration must weave in the trusted English text naturally"
);
assert.match(
  playerSource,
  /intensiveStudentAnsweredRef/u,
  "silent auto-advance must track whether the student answered the current page"
);
assert.match(
  playerSource,
  /coachLatestSubtitleScrollKey/u,
  "subtitle scrolling must react when the latest bubble text changes"
);
assert.match(
  playerSource,
  /requestAnimationFrame[\s\S]*scrollTo\(\{[\s\S]*behavior:\s*"smooth"/u,
  "subtitle scrolling must wait for layout and smoothly follow the newest text"
);

console.log("Intensive storytelling, silent page turns, and subtitle auto-scroll structure verified.");
