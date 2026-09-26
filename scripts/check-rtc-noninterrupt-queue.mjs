import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "components/student/StoryflowTaskPlayer.tsx"),
  "utf8"
);
const localSpeechHandler =
  source.match(/const startLocalStudentSpeechSubtitles = \(\) => \{[\s\S]*?\n  \};/u)?.[0] || "";

assert.match(
  source,
  /pendingStudentSpeechDuringCoachRef[\s\S]*flushPendingStudentSpeechAfterCoach[\s\S]*sendCoachRtcAgentControlMessage/u,
  "speech captured while Mia is talking must be queued and sent after playback"
);
assert.match(
  localSpeechHandler,
  /isLikelyCoachEchoLocalStudentTranscript\(text\)[\s\S]*isCoachRemoteAudioActive\(\)[\s\S]*result\.isFinal[\s\S]*pendingStudentSpeechDuringCoachRef\.current/u,
  "final non-echo student speech must be buffered while Mia is talking"
);
assert.doesNotMatch(
  source,
  />可打断</u,
  "non-interruptible RTC mode must not tell students that Mia can be interrupted"
);
assert.match(
  source,
  /AI说话中，请稍候/u,
  "non-interruptible RTC mode must clearly tell students to wait while Mia speaks"
);

console.log("RTC non-interruptible speech queues student input until Mia finishes.");
