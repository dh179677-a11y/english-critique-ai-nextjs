import assert from "node:assert/strict";

import {
  getCoachAudioClearDelayMs,
  getStoryflowSpeechRecognitionLang,
  shouldScheduleStudentSpeechFallback,
  shouldSendLocalSpeechFallback,
} from "../lib/storyflowRtcTurn.ts";

assert.equal(
  getStoryflowSpeechRecognitionLang("speaking"),
  "en-US",
  "speaking practice must recognize the child's English as English"
);
assert.equal(getStoryflowSpeechRecognitionLang("intensive"), "zh-CN");

assert.equal(shouldScheduleStudentSpeechFallback("speaking", true), true);
assert.equal(
  shouldScheduleStudentSpeechFallback("intensive", true),
  true,
  "a final student subtitle in intensive mode must also get a no-reply fallback"
);
assert.equal(shouldScheduleStudentSpeechFallback("intensive", false), false);

assert.equal(
  getCoachAudioClearDelayMs(6_000, 2_000, 160),
  4_160,
  "audio cleanup must wait for the actual active-until deadline, not the latest short subtitle duration"
);

assert.equal(
  shouldSendLocalSpeechFallback({
    capturedAt: 1_000,
    lastCoachActivityAt: 900,
    isCoachAudioActive: false,
    transcript: "The spots are on his face.",
  }),
  true,
  "final local English must trigger a fallback when RTC produces no response"
);
assert.equal(
  shouldSendLocalSpeechFallback({
    capturedAt: 1_000,
    lastCoachActivityAt: 1_100,
    isCoachAudioActive: true,
    transcript: "The spots are on his face.",
  }),
  false,
  "fallback must be cancelled once the RTC agent has started replying"
);

console.log("Storyflow RTC turn timing and English recognition behavior are correct.");
