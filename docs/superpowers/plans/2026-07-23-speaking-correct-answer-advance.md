# 看图说话答对后自然推进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生说对看图说话当前目标后，Mia 简短认可并立即引导下一句或下一页，不再解释或要求重读。

**Architecture:** 在 `StoryflowTaskPlayer` 的看图说话 RTC 模式规则末尾添加高优先级成功门禁，让最近的模式上下文覆盖通用教学话术。结构测试锁定禁止行为、单目标完成后的翻页指令及多句页面的下一句推进。

**Tech Stack:** React 19、TypeScript、Next.js 16、Volcengine RTC agent prompt、Node.js 结构测试

## Global Constraints

- 不修改语音识别、字幕合并或前端页码状态。
- 不自动翻页；Mia 只明确要求学生翻页。
- 不改变绘本精讲和影子跟读规则。
- 保留 `Sports`→`Spots`、`beef`→`Biff`、`keeper`→`Kipper` 的容错。
- 不提交 `data/portal-store.json`、`data/storyflow-store.json` 或其他用户已有改动。

---

### Task 1: 看图说话成功门禁

**Files:**
- Modify: `scripts/check-storyflow-rtc-voice-structure.mjs`
- Modify: `components/student/StoryflowTaskPlayer.tsx`

**Interfaces:**
- Consumes: `buildCoachRtcLessonStatePrompt()` 中 `resolvedTaskMode === "speaking"` 的 `modeRules`。
- Produces: 看图说话模式末尾的高优先级答对推进规则。

- [ ] **Step 1: 写入失败的结构回归测试**

在 `scripts/check-storyflow-rtc-voice-structure.mjs` 添加：

```js
assert.match(
  source,
  /看图说话最高优先级成功规则[\s\S]*已经完成，禁止再次解释词义、讲解发音、示范或要求重读[\s\S]*当前页还有下一句[\s\S]*当前页全部完成[\s\S]*直接要求学生翻到下一页/u,
  "speaking practice must move on immediately after a correct target"
);
assert.match(
  source,
  /学生说出 Spots[\s\S]*禁止回复[\s\S]*意思是斑点[\s\S]*试着说对这个词[\s\S]*说对了[\s\S]*请翻到下一页/u,
  "speaking practice must not reteach Spots after the student has said it"
);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node scripts/check-storyflow-rtc-voice-structure.mjs`

Expected: FAIL，错误为 `speaking practice must move on immediately after a correct target`。

- [ ] **Step 3: 在看图说话规则末尾添加成功门禁**

在现有 `resolvedTaskMode === "speaking"` 规则数组末尾加入：

```tsx
"看图说话最高优先级成功规则：只要学生已经说出当前目标词或目标句，就视为这一目标已经完成，禁止再次解释词义、讲解发音、示范或要求重读，也禁止表现得像没听见学生回答。",
"答对后的回复必须自然且只推进一次：先用一句很短的肯定承接学生；当前页还有下一句时，立即提示下一句；当前页全部完成时，直接要求学生翻到下一页，不要询问是否愿意继续。",
"示例：学生说出 Spots 后，禁止回复‘意思是斑点’或‘现在试着说对这个词’；如果 Spots 是当前页唯一目标，应回复类似‘说对了！请翻到下一页，我们继续。’",
```

- [ ] **Step 4: 运行目标测试并确认通过**

Run: `node scripts/check-storyflow-rtc-voice-structure.mjs`

Expected: PASS，输出 `Storyflow speaking realtime voice uses the RTC agent structure.`。

- [ ] **Step 5: 检查改动范围**

Run: `git diff --check && git diff -- components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-rtc-voice-structure.mjs`

Expected: 无空白错误；新增内容仅为成功门禁及测试，先前字幕修复保持不变。

### Task 2: 全量验证

**Files:**
- Verify: `components/student/StoryflowTaskPlayer.tsx`
- Verify: `scripts/check-storyflow-rtc-voice-structure.mjs`

**Interfaces:**
- Consumes: Task 1 的高优先级规则。
- Produces: 静态检查、类型检查和生产构建证据。

- [ ] **Step 1: 运行全部 Storyflow 检查**

Run: `for check_file in scripts/check-*.mjs; do node "$check_file"; done`

Expected: 全部退出码为 0。

- [ ] **Step 2: 运行 ESLint**

Run: `npm run lint`

Expected: 0 errors；已有 warnings 单独报告。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: `Compiled successfully`，TypeScript 与静态页面生成通过。

- [ ] **Step 4: 检查最终工作区**

Run: `git status --short && git diff --check`

Expected: 数据文件未被本任务修改；无空白错误。

- [ ] **Step 5: 提交本任务文件**

```bash
git add components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-rtc-voice-structure.mjs docs/superpowers/plans/2026-07-23-speaking-correct-answer-advance.md
git commit -m "fix: advance speaking practice after correct answers"
```

Expected: 不包含数据文件或左右页计划。
