# EnglishPro Critique AI (Next.js)

这是一个基于 Next.js App Router 的前后端一体应用：
- 前端上传视频并展示评分与点评
- 后端 API 路由调用 Gemini 模型
- `GEMINI_API_KEY` 仅保存在服务端环境变量，不会暴露给浏览器

## 1. 安装依赖

```bash
npm install
```

## 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
GEMINI_API_KEY=你的密钥
```

## 3. 启动开发环境

```bash
npm run dev
```

打开 `http://localhost:3000`

## 安全说明

- 前端不会直接调用 Gemini SDK。
- Gemini 调用仅在 `app/api/*` 与 `lib/gemini.ts` 里执行。
- 只要你不把 `.env.local` 提交到仓库，密钥不会进入前端打包产物。
