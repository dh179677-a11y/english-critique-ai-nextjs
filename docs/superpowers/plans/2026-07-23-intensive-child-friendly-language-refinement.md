# 绘本精讲儿童化语言 Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简精讲开场，并将理论化语法讲解改为适合儿童的语境习得方式。

**Architecture:** 只调整 `intensiveLanguageTeachingFlowPrompt` 和学生端精讲欢迎语，不改变 RTC、字幕或页面状态。结构测试锁定精确开场、每跨页最多一个语言规律以及禁止抽象语法理论。

**Tech Stack:** React 19、TypeScript、Node.js 结构测试

## Global Constraints

- 开场“重点”只出现一次，不说“不要求学生跟读”。
- 每个跨页最多讲一个语言规律。
- 使用故事语境、儿童化说法、一到两个短例句或替换应用。
- 禁止主谓宾、宾语补足语、时态定义和动词变位表等抽象理论。
- 不提交用户数据文件或其他未执行计划。

---

### Task 1: 开场和语法风格回归测试

**Files:**
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Consumes: `buildCoachRtcWelcomeMessage`、`intensiveLanguageTeachingFlowPrompt`
- Produces: 精确文案和儿童化语法规则断言。

- [ ] **Step 1: 添加失败测试**

```js
assert.match(
  buildCoachRtcWelcomeMessage,
  /我们开始绘本精讲。今天重点学习原文里的单词、语法和句型应用。我会结合画面讲清楚用法。现在先听我讲当前页。/u,
  "the intensive welcome must use the approved concise copy"
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: FAIL，首先报告开场文案不匹配。

### Task 2: 最小实现与验证

**Files:**
- Modify: `components/student/StoryflowTaskPlayer.tsx`
- Modify: `lib/agentLessonFlow.ts`
- Test: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Produces: 已批准的精简开场和儿童习得式语法提示。

- [ ] **Step 1: 替换精讲欢迎语**

```ts
return "我们开始绘本精讲。今天重点学习原文里的单词、语法和句型应用。我会结合画面讲清楚用法。现在先听我讲当前页。";
```

- [ ] **Step 2: 替换细拆语法规则**

在 `intensiveLanguageTeachingFlowPrompt` 中明确：每跨页最多一个语言规律；先语境句意，再儿童化规律，再一到两个短例句或替换应用；没有必要时不强行讲语法；禁止抽象术语和规则表。

- [ ] **Step 3: 同步学生端精讲 modeRules**

删除“仔细解释句子结构、核心语法”的强制表述，改成：

```ts
"重点句用儿童习得方式讲：先结合故事说清句意，每个跨页最多点出一个有用的表达规律，再用一到两个短例句或替换词展示应用；没有必要的语法点时不要强行讲。",
```

- [ ] **Step 4: 运行目标测试**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: PASS。

- [ ] **Step 5: 运行全量验证**

Run: `for check_file in scripts/check-*.mjs; do node "$check_file"; done && npm run build`

Expected: 全部结构检查和生产构建通过。

- [ ] **Step 6: 提交**

```bash
git add components/student/StoryflowTaskPlayer.tsx lib/agentLessonFlow.ts scripts/check-storyflow-intensive-assessment-structure.mjs docs/superpowers/plans/2026-07-23-intensive-child-friendly-language-refinement.md
git commit -m "fix: simplify intensive lesson language"
```
