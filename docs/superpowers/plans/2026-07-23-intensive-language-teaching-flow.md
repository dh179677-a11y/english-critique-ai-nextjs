# 绘本精讲语言知识流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Storyflow 绘本精讲改成原文驱动的词汇、语法和句型应用课程，移除学生跟读、发音训练及高频图片描述问题。

**Architecture:** 在 `lib/agentLessonFlow.ts` 新增独立的 `intensiveLanguageTeachingFlowPrompt`；RTC 系统提示检测精讲标记后不再注入通用两轮陪学流程。学生端精讲上下文、欢迎语和翻页通知统一使用独立流程，并移除旧的第二轮朗读状态驱动。

**Tech Stack:** Next.js 16、React 19、TypeScript、Volcengine RTC Agent、Node.js 结构测试

## Global Constraints

- 每个跨页最多一个问题，且问题必须直接关联当前英文原文。
- 词义必须结合当前原文、画面和故事情境；生病情境中的 `spots` 优先解释为皮肤红疹/疹子。
- 不要求学生跟读、朗读、练习发音、语调或流畅度。
- 不让学生自由描述画面或预测剧情。
- 不修改影子跟读、看图说话、语音识别、字幕合并、评分和录音功能。
- 不提交 `data/portal-store.json`、`data/storyflow-store.json` 或用户已有未提交改动。

---

### Task 1: 独立精讲语言流程提示

**Files:**
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`
- Modify: `lib/agentLessonFlow.ts`

**Interfaces:**
- Produces: `intensiveLanguageTeachingFlowPrompt: string`
- Consumed by: `lib/volcRtcAgent.ts`、`components/student/StoryflowTaskPlayer.tsx`

- [ ] **Step 1: 添加失败的结构断言**

在 `scripts/check-storyflow-intensive-assessment-structure.mjs` 读取 `agentLessonFlow.ts` 后断言：

```js
assert.match(
  agentLessonFlowSource,
  /export const intensiveLanguageTeachingFlowPrompt[\s\S]*重点单词[\s\S]*词性[\s\S]*常见搭配[\s\S]*重点句[\s\S]*句子结构[\s\S]*核心语法[\s\S]*同结构例句/u,
  "intensive teaching must focus on vocabulary, grammar, sentence structure, and application"
);
assert.match(
  agentLessonFlowSource,
  /当前英文原文、当前画面和故事情境共同确定[\s\S]*spots[\s\S]*皮肤上的红疹|疹子/u,
  "intensive vocabulary explanations must use the current story context"
);
assert.match(
  agentLessonFlowSource,
  /每个可见跨页最多提出一个问题[\s\S]*禁止要求学生跟读、朗读或练习发音[\s\S]*禁止让学生自由描述画面/u,
  "intensive teaching must reduce questions and remove pronunciation practice"
);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: FAIL，提示缺少独立精讲流程。

- [ ] **Step 3: 实现独立精讲提示**

在 `lib/agentLessonFlow.ts` 新增导出，内容明确规定：AI朗读一次、语境词义、词性/搭配/应用、重点句结构和语法、同结构例句、跨页最多一个原文问题、答后翻页；同时明确禁止学生跟读、发音训练、图片描述和剧情预测。

核心文本必须包含：

```ts
export const intensiveLanguageTeachingFlowPrompt = [
  "【绘本精讲独立语言知识流程】",
  "本流程覆盖通用两轮陪学流程；绘本精讲只有一轮语言知识讲解，不进入学生自主朗读和发音反馈。",
  "词义必须由当前英文原文、当前画面和故事情境共同确定。先讲当前绘本里的准确含义，再按需补充其他常见含义。",
  "例如生病、皮肤出现红点的故事情境中，spots 指皮肤上的红疹、疹子或红点，不能只解释为普通斑点。",
  "每个可见跨页最多提出一个问题，左右页全部讲完后再问；问题只能考查当前原文词义、句子结构、核心语法、句型替换应用或原文明确内容。",
  "禁止要求学生跟读、朗读或练习发音、语调、流畅度；禁止让学生自由描述画面、编故事或预测剧情。",
].join("\n");
```

- [ ] **Step 4: 运行目标测试**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: 新增提示断言通过；后续尚未修改的隔离断言可继续失败。

### Task 2: RTC 系统提示模式隔离

**Files:**
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`
- Modify: `lib/volcRtcAgent.ts`

**Interfaces:**
- Consumes: `intensiveLanguageTeachingFlowPrompt`
- Produces: 精讲会话不包含 `agentLessonFlowPrompt` 的 RTC system prompt。

- [ ] **Step 1: 添加失败的隔离断言**

```js
assert.match(
  rtcAgentSource,
  /isIntensiveLanguageTeachingState[\s\S]*intensiveLanguageTeachingFlowPrompt[\s\S]*isIntensiveLanguageTeachingState\(lessonState\)[\s\S]*agentLessonFlowPrompt/u,
  "RTC intensive sessions must replace the generic two-round lesson flow"
);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: FAIL，提示 RTC 精讲仍注入通用两轮流程。

- [ ] **Step 3: 条件注入系统提示**

在 `lib/volcRtcAgent.ts` 导入新提示，增加：

```ts
const isIntensiveLanguageTeachingState = (lessonState: string) =>
  /【绘本精讲RTC练习】|任务模式：绘本精讲/.test(lessonState);
```

在 `buildSystemPrompt` 中，精讲时注入 `intensiveLanguageTeachingFlowPrompt`，其他模式继续使用 `agentLessonFlowPrompt`：

```ts
isIntensiveLanguageTeachingState(lessonState)
  ? intensiveLanguageTeachingFlowPrompt
  : agentLessonFlowPrompt,
```

- [ ] **Step 4: 运行目标测试确认通过**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: RTC 模式隔离断言通过。

### Task 3: 学生端精讲上下文和旧状态清理

**Files:**
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`
- Modify: `components/student/StoryflowTaskPlayer.tsx`

**Interfaces:**
- Consumes: `intensiveLanguageTeachingFlowPrompt`
- Produces: 精讲欢迎语、当前页上下文和翻页通知均使用新流程。

- [ ] **Step 1: 添加失败的学生端断言**

```js
assert.match(
  source,
  /resolvedTaskMode === "intensive"[\s\S]*intensiveLanguageTeachingFlowPrompt[\s\S]*当前页分栏原文/u,
  "Storyflow intensive context must use the language teaching flow"
);
assert.doesNotMatch(
  intensiveModeRules,
  /第二轮|自主朗读|发音准确度|朗读流畅度|语调|跟读/u,
  "Storyflow intensive mode must not retain pronunciation or rereading steps"
);
assert.match(
  buildCoachRtcWelcomeMessage,
  /重点单词、语法和重点句[\s\S]*不要求学生跟读/u,
  "the intensive welcome must introduce the language teaching lesson"
);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: FAIL，提示学生端仍保留旧两轮流程。

- [ ] **Step 3: 替换精讲欢迎语和 modeRules**

将精讲欢迎语改为简短说明本课会讲重点单词、语法、重点句和应用，不要求学生跟读。精讲 `modeRules` 引用 `intensiveLanguageTeachingFlowPrompt`，移除 `agentLessonFlowPrompt`、第二轮朗读和发音反馈文本。

- [ ] **Step 4: 替换翻页通知**

精讲翻页时发送新流程和当前分栏原文，明确从本页语言讲解开始；不再发送 `round1_picture` 或要求学生观察描述画面。

- [ ] **Step 5: 移除精讲旧状态依赖**

删除 `StoryflowTaskPlayer` 中仅服务旧精讲两轮流程的 `intensiveLessonStep` state/ref、`buildIntensiveLessonState`、`updateIntensiveLessonStep`、`advanceIntensiveLessonStepFromSubtitle` 及调用。精讲本地字幕语言固定为 `zh-CN`，因为学生互动以中文理解和应用回答为主。

- [ ] **Step 6: 更新旧结构断言并运行目标测试**

删除要求 `round2_student_read`、`round2_feedback` 和 `round1_picture` 的旧断言，改为新独立流程断言。

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: PASS，输出 `Storyflow intensive reading and score feedback structure is wired.`。

- [ ] **Step 7: 检查范围和格式**

Run: `git diff --check && git diff -- lib/agentLessonFlow.ts lib/volcRtcAgent.ts components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: 无空白错误；看图说话和影子跟读规则未被改写。

### Task 4: 全量验证

**Files:**
- Verify: `lib/agentLessonFlow.ts`
- Verify: `lib/volcRtcAgent.ts`
- Verify: `components/student/StoryflowTaskPlayer.tsx`
- Verify: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 的完整精讲流程。
- Produces: 静态检查、类型检查和构建证据。

- [ ] **Step 1: 运行全部结构检查**

Run: `for check_file in scripts/check-*.mjs; do node "$check_file"; done`

Expected: 全部退出码为 0。

- [ ] **Step 2: 运行 ESLint**

Run: `npm run lint`

Expected: 0 errors；已有 warnings 单独报告。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: `Compiled successfully`，TypeScript 与静态页面生成通过。

- [ ] **Step 4: 检查工作区**

Run: `git status --short && git diff --check`

Expected: 用户数据文件保持未提交状态且不包含在本任务变更中。

- [ ] **Step 5: 提交实现文件**

```bash
git add lib/agentLessonFlow.ts lib/volcRtcAgent.ts components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-intensive-assessment-structure.mjs docs/superpowers/plans/2026-07-23-intensive-language-teaching-flow.md
git commit -m "feat: refocus intensive lessons on language teaching"
```

Expected: 不提交数据文件、看图说话计划或左右页计划。
