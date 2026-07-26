# Intensive Vocabulary Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Mia from repeating a full vocabulary explanation when the same word family was already taught on an earlier page of the current intensive-reading book.

**Architecture:** Add a pure TypeScript vocabulary-memory module that normalizes word families, filters function words, and formats a bounded list from prior pages. `StoryflowTaskPlayer` computes that prompt from the current book and page index and injects it through the existing RTC lesson-state builder, which already feeds session start, page changes, and reconnect continuation.

**Tech Stack:** TypeScript, React 19, Next.js 16, Node.js assertion scripts, Volcengine RTC prompt pipeline.

## Global Constraints

- Apply only to `intensive` mode.
- Treat `spot/spots`, `come/came`, and `child/children` as the same families.
- Never modify page source text or persisted `keyVocabulary`.
- Derive memory only from pages before the current page.
- Filter high-frequency function words and the generated page marker `right`.
- A repeated family gets at most one short reminder; do not repeat part of speech, full meaning lists, collocations, pronunciation breakdowns, or life examples.
- Missing page vocabulary must degrade to an empty memory block without blocking RTC.
- Session start, page changes, and reconnect continuation must all receive the same memory block through `buildCoachRtcLessonStatePrompt()`.

---

### Task 1: Specify and Implement Vocabulary-Family Memory

**Files:**
- Create: `lib/intensiveVocabularyMemory.ts`
- Create: `scripts/check-intensive-vocabulary-memory.mjs`

**Interfaces:**
- Produces: `normalizeIntensiveVocabularyFamily(word: string): string`.
- Produces: `buildPreviouslyTaughtVocabulary(pages, currentPageIndex, limit?): IntensiveVocabularyMemoryEntry[]`.
- Produces: `formatPreviouslyTaughtVocabularyPrompt(entries): string`.
- Consumes: pages shaped as `{ keyVocabulary?: string[] }`.

- [ ] **Step 1: Write a failing executable pure-function test**

Create `scripts/check-intensive-vocabulary-memory.mjs`. Read `lib/intensiveVocabularyMemory.ts`, transpile it with the installed `typescript` package using `ts.transpileModule(..., { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })`, import the output from a `data:text/javascript;base64,...` URL, and assert:

```js
assert.equal(normalizeIntensiveVocabularyFamily("Spots!"), "spot");
assert.equal(normalizeIntensiveVocabularyFamily("came"), "come");
assert.equal(normalizeIntensiveVocabularyFamily("Children"), "child");
assert.equal(normalizeIntensiveVocabularyFamily("climbed"), "climb");
assert.equal(normalizeIntensiveVocabularyFamily("the"), "");
assert.equal(normalizeIntensiveVocabularyFamily("RIGHT"), "");

const pages = [
  { keyVocabulary: ["Naughty", "children", "the"] },
  { keyVocabulary: ["Two", "children", "came"] },
  { keyVocabulary: ["They", "climbed", "spots"] },
];

assert.deepEqual(buildPreviouslyTaughtVocabulary(pages, 0), []);
assert.deepEqual(buildPreviouslyTaughtVocabulary(pages, 1), [
  { family: "child", forms: ["children"], lastPageIndex: 0 },
  { family: "naughty", forms: ["Naughty"], lastPageIndex: 0 },
]);

const pageThreeMemory = buildPreviouslyTaughtVocabulary(pages, 2);
assert.equal(pageThreeMemory.filter((entry) => entry.family === "child").length, 1);
assert.ok(pageThreeMemory.some((entry) => entry.family === "come"));
assert.ok(!pageThreeMemory.some((entry) => entry.family === "the"));

const prompt = formatPreviouslyTaughtVocabularyPrompt(pageThreeMemory);
assert.match(prompt, /此前已经精讲的词族/u);
assert.match(prompt, /child（此前形式：children）/u);
assert.match(prompt, /不得重复词性、完整词义列表、常见搭配、发音拆解或生活例句/u);
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
node scripts/check-intensive-vocabulary-memory.mjs
```

Expected: FAIL because `lib/intensiveVocabularyMemory.ts` does not exist.

- [ ] **Step 3: Implement conservative normalization and memory construction**

Create `lib/intensiveVocabularyMemory.ts` with:

```ts
export type IntensiveVocabularyPage = {
  keyVocabulary?: string[];
};

export type IntensiveVocabularyMemoryEntry = {
  family: string;
  forms: string[];
  lastPageIndex: number;
};
```

Implementation requirements:

- Clean surrounding punctuation and lowercase for comparison.
- Return `""` for a fixed stop-word set containing at least `a, an, the, and, or, but, is, am, are, was, were, be, been, being, to, of, in, on, at, for, from, with, by, it, he, she, they, we, you, i, this, that, these, those, right, left`.
- Apply explicit irregular mappings for `came -> come`, `children -> child`, `men -> man`, `women -> woman`, `mice -> mouse`, `teeth -> tooth`, `feet -> foot`, `went -> go`, `gone -> go`, `saw -> see`, and `seen -> see`.
- Apply conservative suffix handling: plural `ies -> y`, regular plural `s -> base` excluding `ss/us/is`, and common `ed -> base`.
- Iterate only `pages.slice(0, Math.max(0, currentPageIndex))`.
- Deduplicate by family, preserve distinct original display forms, and update `lastPageIndex`.
- Sort current-page repeated families first, then by most recent prior page, then alphabetically.
- Clamp `limit` to `1..32`, defaulting to `24`.
- Format an empty list as `【本次绘本此前已经精讲的词族】\\n暂无。`.
- Format a non-empty list as one family per line plus the short-review and no-repeat rules.

- [ ] **Step 4: Run the pure-function test and verify green**

Run:

```bash
node scripts/check-intensive-vocabulary-memory.mjs
```

Expected: exit code 0.

- [ ] **Step 5: Commit the tested helper**

```bash
git add lib/intensiveVocabularyMemory.ts scripts/check-intensive-vocabulary-memory.mjs
git commit -m "feat: track previously taught vocabulary families"
```

---

### Task 2: Inject Vocabulary Memory into Every Intensive RTC Context

**Files:**
- Modify: `lib/agentLessonFlow.ts`
- Modify: `components/student/StoryflowTaskPlayer.tsx`
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`
- Test: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Consumes: `buildPreviouslyTaughtVocabulary()` and `formatPreviouslyTaughtVocabularyPrompt()`.
- Produces: `intensiveVocabularyMemoryPrompt` for the current page.
- Existing `buildCoachRtcLessonStatePrompt()` remains the single shared delivery path for start, page-change synchronization, page-change continuation, and reconnect continuation.

- [ ] **Step 1: Add failing RTC structure assertions**

Extend `scripts/check-storyflow-intensive-assessment-structure.mjs` to assert:

```js
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
```

- [ ] **Step 2: Run the RTC structure test and verify red**

Run:

```bash
node scripts/check-storyflow-intensive-assessment-structure.mjs
```

Expected: FAIL on the new global no-repeat rule.

- [ ] **Step 3: Add the global intensive no-repeat teaching rule**

In `intensiveLanguageTeachingFlowPrompt` within `lib/agentLessonFlow.ts`, add rules stating:

```text
同一词族在前页已经精讲过时，当前页最多用一句话简短回顾它在当前句中的意思，然后立即进入新词、当前句结构或应用。
禁止重复词性、完整词义列表、常见搭配、发音拆解和生活例句；词形变化也算同一词族，例如 spot/spots、come/came、child/children。
```

- [ ] **Step 4: Build page-scoped memory in the student player**

Import the two helper functions into `StoryflowTaskPlayer.tsx`.

Immediately before `buildCoachRtcLessonStatePrompt`, compute:

```ts
const intensiveVocabularyMemory = buildPreviouslyTaughtVocabulary(
  pages,
  safeIndex
);
const intensiveVocabularyMemoryPrompt =
  formatPreviouslyTaughtVocabularyPrompt(intensiveVocabularyMemory);
```

Only use the formatted block when `resolvedTaskMode === "intensive"`.

- [ ] **Step 5: Add the block to the shared lesson-state prompt**

In the intensive `modeRules` array inside `buildCoachRtcLessonStatePrompt()`, place `intensiveVocabularyMemoryPrompt` immediately after `intensiveLanguageTeachingFlowPrompt`, followed by an explicit instruction:

```text
清单中的词族已经在本次绘本前页完成精讲。当前页再次出现时只能简短回顾，不得重新完整讲解；优先讲当前页第一次出现的新重点词。
```

Because session creation, reconnect continuation, page-change silent synchronization, and page-change continuation already call `buildCoachRtcLessonStatePrompt()`, do not create separate duplicated memory prompts in those flows.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node scripts/check-intensive-vocabulary-memory.mjs
node scripts/check-storyflow-intensive-assessment-structure.mjs
node scripts/check-storyflow-rtc-voice-structure.mjs
```

Expected: all exit 0.

- [ ] **Step 7: Commit the RTC integration**

```bash
git add lib/agentLessonFlow.ts components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-intensive-assessment-structure.mjs
git commit -m "feat: avoid repeated intensive vocabulary explanations"
```

---

### Task 3: Full Verification

**Files:**
- Verify: `lib/intensiveVocabularyMemory.ts`
- Verify: `lib/agentLessonFlow.ts`
- Verify: `components/student/StoryflowTaskPlayer.tsx`
- Verify: `scripts/check-intensive-vocabulary-memory.mjs`
- Verify: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: evidence that vocabulary deduplication works without regressing RTC or the production build.

- [ ] **Step 1: Run focused behavioral and structure tests**

```bash
node scripts/check-intensive-vocabulary-memory.mjs
node scripts/check-storyflow-intensive-assessment-structure.mjs
node scripts/check-storyflow-rtc-voice-structure.mjs
```

Expected: all exit 0.

- [ ] **Step 2: Run deployment-data regression coverage**

```bash
node scripts/check-production-data-directory-structure.mjs
node scripts/check-portal-feature-settings-structure.mjs
```

Expected: both exit 0.

- [ ] **Step 3: Validate patch formatting**

```bash
git diff --check HEAD~2
```

Expected: no output and exit code 0.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: exit code 0 and all Next.js routes compile.

- [ ] **Step 5: Review scope**

```bash
git status --short
git diff HEAD~2..HEAD --stat
git log --oneline -5
```

Expected: only the vocabulary-memory helper, intensive prompts, student RTC integration, tests, design, and plan are present; ignored runtime JSON files remain absent from Git status.
