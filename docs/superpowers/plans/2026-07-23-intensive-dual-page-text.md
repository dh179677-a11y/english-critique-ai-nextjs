# 绘本精讲左右页原文 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让绘本精讲原文在跨页数据中以 `LEFT PAGE`、`RIGHT PAGE` 双栏展示，并保留单页回退。

**Architecture:** 继续使用 `StoryflowTaskPlayer.tsx` 现有的 `splitDualPageText(value)`，在当前页派生出左右原文；精讲原文 JSX 根据 `rightText` 是否存在选择双栏或单栏。测试沿用项目现有结构检查脚本，并通过浏览器对目标页面进行视觉与响应式验证。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS、Node.js 结构检查脚本、in-app Browser

## Global Constraints

- 仅调整学生端绘本精讲页面的原文展示区域。
- 不改变后台数据结构、OCR 内容、页面翻页、Mia 提示词、字幕或语音识别行为。
- iPad 和桌面双栏，小屏幕上下排列。
- 双页不显示 `[RIGHT_PAGE]`；单页继续显示 `PAGE TEXT`；空内容继续显示原缺省文案。
- 不修改 `data/portal-store.json`、`data/storyflow-store.json` 或用户已有未提交改动。

---

### Task 1: 精讲原文双页回归测试与渲染

**Files:**
- Modify: `scripts/check-storyflow-intensive-assessment-structure.mjs`
- Modify: `components/student/StoryflowTaskPlayer.tsx`

**Interfaces:**
- Consumes: `splitDualPageText(value: string): { leftText: string; rightText: string }`
- Produces: `intensivePageTextParts`，供精讲原文 JSX 决定双页或单页布局。

- [ ] **Step 1: 写入失败的结构回归测试**

在 `scripts/check-storyflow-intensive-assessment-structure.mjs` 增加断言，要求精讲页派生左右原文，并包含双页与单页渲染分支：

```js
assert.match(
  source,
  /const intensivePageTextParts = splitDualPageText\(page\?\.visibleText \|\| ""\)/u,
  "intensive page text must split the persisted left and right page source"
);
assert.match(
  source,
  /isIntensiveMode[\s\S]*intensivePageTextParts\.rightText[\s\S]*Left Page[\s\S]*Right Page[\s\S]*Page Text/u,
  "intensive page text must render dual-page cards and retain the single-page fallback"
);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: FAIL，错误为 `intensive page text must split the persisted left and right page source`。

- [ ] **Step 3: 增加当前精讲页的左右原文派生值**

在 `StoryflowTaskPlayer` 当前 `page` 派生值附近加入：

```tsx
const intensivePageTextParts = splitDualPageText(page?.visibleText || "");
```

- [ ] **Step 4: 用双页/单页分支替换精讲原文块**

双页分支使用响应式网格和既有影子跟读配色；正文不使用 `truncate`：

```tsx
{intensivePageTextParts.rightText ? (
  <div className="mt-2 grid gap-2 md:grid-cols-2">
    <div className="rounded-[1.05rem] border border-sky-300 bg-white px-4 py-3 text-left shadow-[0_12px_28px_rgba(120,149,188,0.1)]">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-500">Left Page</p>
      <p className="mt-2 text-base font-semibold leading-7 text-slate-800">
        {intensivePageTextParts.leftText}
      </p>
    </div>
    <div className="rounded-[1.05rem] border border-indigo-200 bg-white px-4 py-3 text-left shadow-[0_12px_28px_rgba(120,149,188,0.1)]">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500">Right Page</p>
      <p className="mt-2 text-base font-semibold leading-7 text-slate-800">
        {intensivePageTextParts.rightText}
      </p>
    </div>
  </div>
) : (
  <div className="mt-2 rounded-[1.05rem] border border-sky-100 bg-white px-4 py-3 text-center shadow-[0_12px_28px_rgba(120,149,188,0.1)]">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-500">Page Text</p>
    <p className="mt-2 text-base font-semibold leading-7 text-slate-800">
      {intensivePageTextParts.leftText || "当前页暂无后台原文，Mia 会优先根据屏幕画面讲解。"}
    </p>
  </div>
)}
```

- [ ] **Step 5: 运行目标测试并确认通过**

Run: `node scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: PASS，输出 `Storyflow intensive reading and score feedback structure is wired.`。

- [ ] **Step 6: 审查变更范围**

Run: `git diff --check && git diff -- components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-intensive-assessment-structure.mjs`

Expected: 无空白错误；diff 只包含精讲原文派生值、渲染块和测试断言。

### Task 2: 全量验证与浏览器 QA

**Files:**
- Verify: `components/student/StoryflowTaskPlayer.tsx`
- Verify: `scripts/check-storyflow-intensive-assessment-structure.mjs`

**Interfaces:**
- Consumes: Task 1 完成的响应式精讲原文布局。
- Produces: 构建、静态检查和真实渲染验证证据。

- [ ] **Step 1: 运行全部 Storyflow 结构检查**

Run:

```bash
for check_file in scripts/check-*.mjs; do node "$check_file"; done
```

Expected: 所有检查退出码为 0。

- [ ] **Step 2: 运行 ESLint**

Run: `npm run lint`

Expected: 0 errors；已有警告单独记录，不扩展本任务处理范围。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: `Compiled successfully`，TypeScript 与静态页面生成通过，退出码为 0。

- [ ] **Step 4: 启动本地应用并使用 in-app Browser 验证目标流程**

Target flow: `/tasks/<task-id>/intensive` → 导航到包含 `[RIGHT_PAGE]` 的跨页 → 页面下方显示左右两张原文卡片且不显示分隔符。

验证以下项目：

```text
Page identity: URL 与标题正确
Not blank: 绘本图片、翻页控件和原文卡片存在
No overlay: 无 Next.js/React 错误浮层
Console: 无与本次修改相关的 error/warn
Desktop/iPad: LEFT PAGE 与 RIGHT PAGE 左右排列
Mobile: 两张卡片上下排列且正文无裁切
Interaction: 翻到单页后仍显示 PAGE TEXT 单栏
```

- [ ] **Step 5: 最终检查工作区**

Run: `git status --short && git diff --check`

Expected: 用户原有数据文件保持不变；本任务只新增计划/规格并修改目标组件与测试脚本。

- [ ] **Step 6: 提交实现**

```bash
git add components/student/StoryflowTaskPlayer.tsx scripts/check-storyflow-intensive-assessment-structure.mjs docs/superpowers/plans/2026-07-23-intensive-dual-page-text.md
git commit -m "fix: split intensive page text by spread"
```

Expected: 仅提交本任务文件，不包含 `data/portal-store.json`、`data/storyflow-store.json` 或先前字幕修复文件。
