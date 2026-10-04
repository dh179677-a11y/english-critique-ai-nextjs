import assert from "node:assert/strict";
import test from "node:test";

import { shouldAutoAdvanceIntensivePage } from "../lib/intensiveAutoAdvance";

test("advances after Mia finishes feedback to a student answer without a spoken cue", () => {
  const completedFeedback = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    text: "回答得很准确，你发现了 Kipper 脸上的红疹。",
    canNext: true,
    studentAnswered: true,
  };

  assert.equal(
    shouldAutoAdvanceIntensivePage(completedFeedback),
    true
  );
});

test("does not advance before the student has answered the page question", () => {
  const openingLecture = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    text: "一天早晨，Kipper 发现脸上出现了红红的小点。What happened to Kipper?",
    canNext: true,
    studentAnswered: false,
  };

  assert.equal(
    shouldAutoAdvanceIntensivePage(openingLecture),
    false
  );
});

test("does not advance for partial subtitles, student speech, or another task mode", () => {
  const base = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    text: "回答得很准确。",
    canNext: true,
    studentAnswered: true,
  };

  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, definite: false }), false);
  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, role: "student" }), false);
  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, mode: "speaking" }), false);
});

test("does not advance beyond the last page", () => {
  const base = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    text: "回答得很准确。",
    canNext: true,
    studentAnswered: true,
  };

  assert.equal(
    shouldAutoAdvanceIntensivePage({
      ...base,
      canNext: false,
    }),
    false
  );
});
