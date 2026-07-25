# EnglishPro Critique AI

使用说明见 [`docs/user-guide.zh-CN.md`](./docs/user-guide.zh-CN.md)。

这是一个基于 Next.js App Router 的前后端一体应用：
- 前端上传视频并展示评分与点评
- 后端 API 路由调用兼容 OpenAI 的 LLM 中转
- `LLM_API_KEY` 仅保存在服务端环境变量，不会暴露给浏览器

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
LLM_BASE_URL=https://api.whatai.cc
LLM_API_KEY=你的密钥
LLM_MODEL=gemini-3-pro-preview
COS_SECRET_ID=你的 COS SecretId
COS_SECRET_KEY=你的 COS SecretKey
COS_BUCKET=你的存储桶名称
COS_REGION=ap-guangzhou
COS_OBJECT_PREFIX=videos
NEXT_PUBLIC_INVITE_CODE=VIP888
SESSION_SECRET=一段足够长的随机字符串
```

### 3. 启动开发环境

```bash
npm run dev
```

打开 `http://localhost:3000`

## 腾讯云服务器部署

这套项目适合部署到腾讯云轻量应用服务器或 CVM，推荐 Ubuntu 22.04。

### 1. 服务器初始化

安装 Node.js 22、Nginx 和 PM2：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

检查版本：

```bash
node -v
npm -v
pm2 -v
```

### 2. 拉取项目

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <你的仓库地址> english-critique-ai
cd english-critique-ai
npm install
```

### 3. 配置生产环境变量

```bash
cp .env.example .env.production
```

编辑 `.env.production`：

```env
LLM_BASE_URL=https://api.whatai.cc
LLM_API_KEY=你的线上 key
LLM_MODEL=gemini-3-pro-preview
COS_SECRET_ID=你的 COS SecretId
COS_SECRET_KEY=你的 COS SecretKey
COS_BUCKET=你的存储桶名称
COS_REGION=ap-guangzhou
COS_OBJECT_PREFIX=videos
NEXT_PUBLIC_INVITE_CODE=VIP888
SESSION_SECRET=一段足够长的随机字符串
```

`ecosystem.config.cjs` 会在启动时自动读取项目根目录下的 `.env.production`。

### 4. 构建并启动

```bash
npm run build
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

默认应用会监听 `3000` 端口。

### 5. 配置 Nginx 反向代理

新建 `/etc/nginx/sites-available/english-critique-ai`：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/english-critique-ai /etc/nginx/sites-enabled/english-critique-ai
sudo nginx -t
sudo systemctl reload nginx
```

### 6. 配置 HTTPS

如果你已经把域名解析到腾讯云服务器，可以直接用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 7. 首次迁移生产数据

账号、课程、作业和 COS 视频关联必须放在代码目录之外。生产环境固定使用：

```text
/root/english-critique-data
```

**首次升级必须先迁移数据，再拉取新代码。** 如果先执行 `git pull`，Git 可能移除或覆盖代码目录内原先被跟踪的数据文件。

当前腾讯云服务器的项目目录是 `/root/english-critique-ai-nextjs`。首次升级执行：

```bash
cd /root/english-critique-ai-nextjs
pm2 stop english-critique-ai

MIGRATION_BACKUP="/root/data-migration-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$MIGRATION_BACKUP" /root/english-critique-data
cp -a data/portal-store.json data/storyflow-store.json "$MIGRATION_BACKUP/"
cp -a data/portal-store.json data/storyflow-store.json /root/english-critique-data/

node -e '
const fs = require("fs");
for (const file of [
  "/root/english-critique-data/portal-store.json",
  "/root/english-critique-data/storyflow-store.json",
]) JSON.parse(fs.readFileSync(file, "utf8"));
console.log("生产数据迁移校验通过");
'

grep -q "^APP_DATA_DIR=" .env.production \
  && sed -i "s|^APP_DATA_DIR=.*|APP_DATA_DIR=/root/english-critique-data|" .env.production \
  || printf "\nAPP_DATA_DIR=/root/english-critique-data\n" >> .env.production

git pull
npm install
npm run build
pm2 restart english-critique-ai --update-env
```

启动后检查外部数据：

```bash
node - <<'NODE'
const fs = require("fs");

const portal = JSON.parse(
  fs.readFileSync("/root/english-critique-data/portal-store.json", "utf8")
);
const storyflow = JSON.parse(
  fs.readFileSync("/root/english-critique-data/storyflow-store.json", "utf8")
);
const videoCount = (storyflow.documents || []).reduce(
  (total, document) => total + (document.aiAnimations?.length || 0),
  0
);

console.log({
  users: portal.users?.length || 0,
  classes: portal.classes?.length || 0,
  records: portal.records?.length || 0,
  documents: storyflow.documents?.length || 0,
  assignments: storyflow.assignments?.length || 0,
  videoAssociations: videoCount,
});
NODE
```

确认数量正确后，再登录老师端检查现有学员和动画视频。迁移失败时不要删除 `/root/english-critique-data` 或 `$MIGRATION_BACKUP`，先恢复旧版本并使用备份文件。

### 8. 后续更新代码

完成首次迁移后，后续部署只更新代码：

```bash
cd /root/english-critique-ai-nextjs
git pull
npm install
npm run build
pm2 restart english-critique-ai --update-env
```

## 部署注意事项

- 当前版本会先从浏览器直传视频到腾讯云 COS，再把 `objectKey` 发给 `/api/analyze`。
- 登录态使用服务端签名的 `httpOnly cookie`，生产环境必须配置 `SESSION_SECRET`。
- 生产环境的账号、班级、测评、课程、作业和视频关联保存在 `APP_DATA_DIR` 指定的目录；腾讯云当前固定为 `/root/english-critique-data`。
- 本地未设置 `APP_DATA_DIR` 时仍使用项目内 `data/`。运行时 JSON 已从 Git 跟踪中移除，不要再次提交。
- 当前文件存储适合单机部署；如果后面改成多机或 Serverless，需要迁移到数据库。
- 分析接口会在服务端生成临时下载链接，再交给上游 LLM 读取。
- Nginx 仍建议保留较大的 `client_max_body_size`，但大文件不再穿过 Next.js 服务端。
- COS 存储桶建议保持私有读写，项目会按需生成临时签名链接。
- COS 存储桶需要配置 CORS，至少允许站点域名对 `PUT`、`GET`、`HEAD` 发起请求，并放行 `Content-Type` 头。

## COS CORS 示例

腾讯云 COS 控制台里可以直接按这个思路配置，模板文件见 [`docs/tencent-cos-cors.xml`](./docs/tencent-cos-cors.xml)。

把里面的域名替换成你自己的正式域名；本地调试时可以先保留 `http://localhost:3000`。

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://your-domain.com</AllowedOrigin>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

如果你后面把前端域名改成 `https://app.xxx.com`，记得同步更新 COS 的 `AllowedOrigin`，否则浏览器会在上传阶段直接报跨域错误。

## 安全说明

- 前端不会直接持有 `LLM_API_KEY`。
- LLM 调用仅在 `app/api/*` 与 `lib/gemini.ts` 里执行。
- 不要把 `.env.local`、`.env.production` 提交到 Git。
