import assert from "node:assert/strict";
import test from "node:test";

import {
  INTENSIVE_AUTO_ADVANCE_CUE,
  shouldAutoAdvanceIntensivePage,
} from "../lib/intensiveAutoAdvance";

test("advances only after Mia finishes an intensive page", () => {
  assert.equal(
    shouldAutoAdvanceIntensivePage({
      mode: "intensive",
      role: "coach",
      definite: true,
      text: `回答得很准确。${INTENSIVE_AUTO_ADVANCE_CUE}`,
      canNext: true,
    }),
    true
  );
});

test("accepts harmless punctuation and spacing changes in the completion cue", () => {
  assert.equal(
    shouldAutoAdvanceIntensivePage({
      mode: "intensive",
      role: "coach",
      definite: true,
      text: "回答正确。这一页讲完了, 我们自动进入下一页",
      canNext: true,
    }),
    true
  );
});

test("does not advance for partial subtitles, student speech, or another task mode", () => {
  const base = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    text: INTENSIVE_AUTO_ADVANCE_CUE,
    canNext: true,
  };

  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, definite: false }), false);
  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, role: "student" }), false);
  assert.equal(shouldAutoAdvanceIntensivePage({ ...base, mode: "speaking" }), false);
});

test("does not advance from ordinary next-page wording or beyond the last page", () => {
  const base = {
    mode: "intensive",
    role: "coach" as const,
    definite: true,
    canNext: true,
  };

  assert.equal(
    shouldAutoAdvanceIntensivePage({
      ...base,
      text: "回答完这个问题，我们再看下一页。",
    }),
    false
  );
  assert.equal(
    shouldAutoAdvanceIntensivePage({
      ...base,
      text: INTENSIVE_AUTO_ADVANCE_CUE,
      canNext: false,
    }),
    false
  );
});
