# 生产数据目录与部署代码分离设计

## 目标

确保从 VS Code 修改代码、推送 GitHub 并重新部署时，不再覆盖腾讯云服务器上现有的账号、班级、测评记录、课程、作业和视频关联。

线上生产数据固定保存在：

```text
/root/english-critique-data
```

腾讯云 COS 中的视频对象不迁移。本设计保护的是 `storyflow-store.json` 中指向 COS 对象的关联信息。

## 当前问题

项目当前把运行时数据写在代码仓库内：

```text
data/portal-store.json
data/storyflow-store.json
```

这两个文件同时被 Git 跟踪。部署过程中重新拉取或替换仓库时，线上运行时数据可能被仓库快照覆盖。

## 方案选择

采用环境变量控制的外部数据目录：

```env
APP_DATA_DIR=/root/english-critique-data
```

不采用写死服务器路径的方案，因为本地开发和其他部署环境需要保持可移植性。本次不迁移到数据库；数据库迁移属于范围更大、需要单独规划的后续工作。

## 数据路径规则

新增一个服务端数据路径模块，集中解析数据目录：

- `APP_DATA_DIR` 有非空值时，解析为绝对路径并作为数据目录。
- `APP_DATA_DIR` 未设置或仅包含空白时，回退到 `path.join(process.cwd(), "data")`，保持本地开发兼容性。
- `portalStore.ts` 和 `storyflowServerStore.ts` 必须共用该模块，禁止各自重新实现路径解析。
- 数据目录无法创建或写入时，操作必须抛出明确错误，不得静默回退到项目内目录，也不得用空数据覆盖既有状态。

对应文件为：

```text
<APP_DATA_DIR>/portal-store.json
<APP_DATA_DIR>/storyflow-store.json
```

## Git 数据隔离

以下运行时文件从 Git 索引中移除，并加入 `.gitignore`：

```text
data/portal-store.json
data/storyflow-store.json
```

本地现有文件保留在工作区，不随移除索引操作删除。任何账号、密码哈希、课程记录或视频关联都不得再次提交到 GitHub。

## 配置与部署

`.env.example` 增加 `APP_DATA_DIR` 的用途、线上推荐值和本地回退说明。`ecosystem.config.cjs` 已读取 `.env.production`，因此无需引入新的配置加载机制。

首次上线必须严格按以下顺序执行：

1. 停止 PM2 应用，阻止迁移期间继续写数据。
2. 为当前两个 JSON 创建带时间戳的额外备份。
3. 创建 `/root/english-critique-data`。
4. 把当前线上两个 JSON 复制到该目录。
5. 在 `.env.production` 设置 `APP_DATA_DIR=/root/english-critique-data`。
6. 拉取新代码并构建。
7. 启动 PM2。
8. 验证外部目录中的账号数量、课程数量、视频关联数量和文件更新时间。
9. 登录老师端，检查现有账号和动画视频。

首次迁移不得先拉取会删除 Git 跟踪数据文件的新提交。README 必须提供可直接执行的安全命令和回滚步骤。

后续部署只更新代码并构建，不再复制或恢复生产 JSON。外部数据目录需要独立备份。

## 测试策略

增加结构化自动测试，验证：

1. 设置 `APP_DATA_DIR` 时，两个存储文件都定位到指定目录。
2. 未设置或值为空白时，路径回退到项目内 `data/`。
3. 相对路径会被解析为绝对路径，避免运行目录变化造成数据漂移。
4. 两个存储模块引用统一的数据路径模块。
5. `.gitignore` 忽略两个运行时 JSON。
6. 示例环境变量和 README 同时包含首次迁移要求。

完成代码修改后运行相关结构测试、TypeScript/项目检查以及生产构建。只有全部通过后才能提交实现。

## 错误处理与恢复

- 外部数据目录不存在时，应用按现有行为创建目录和缺失文件。
- 生产迁移时必须先复制已有文件，因此正常启动不应生成空数据。
- JSON 损坏时继续沿用现有读取行为，但部署文档要求保留迁移前备份以便人工恢复。
- 如果新版启动失败，停止应用，恢复旧代码或旧进程配置，并继续使用迁移前备份；不得删除 `/root/english-critique-data`。

## 不在本次范围内

- 把 JSON 迁移到 MySQL 或 PostgreSQL。
- 移动或重新上传腾讯云 COS 对象。
- 修改账号、课程或视频的数据结构。
- 自动合并多个服务器节点的数据。
