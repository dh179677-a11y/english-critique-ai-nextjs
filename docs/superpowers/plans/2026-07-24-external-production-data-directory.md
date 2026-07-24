# External Production Data Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep production accounts, course records, assignments, and COS video associations outside the Git deployment directory so future code deployments cannot overwrite them.

**Architecture:** Add one server-only path resolver that reads `APP_DATA_DIR`, resolves it to an absolute directory, and falls back to the existing project `data/` directory for local development. Both JSON stores consume this resolver; Git stops tracking the runtime JSON files; deployment documentation enforces a backup-first migration to `/root/english-critique-data`.

**Tech Stack:** Next.js 16, TypeScript, Node.js `path`/`fs`, Node assertion-based structure tests, PM2, Git.

## Global Constraints

- Production data directory is exactly `/root/english-critique-data`.
- Local development without `APP_DATA_DIR` continues to use `<project>/data`.
- COS objects are not moved; only their metadata associations in `storyflow-store.json` are protected.
- A configured but unusable external directory must fail visibly and must not silently fall back.
- Runtime account and course JSON files must not remain tracked by Git.
- The first production migration must copy live data before pulling the commit that untracks the JSON files.

---

### Task 1: Specify External Data Directory Behavior

**Files:**
- Create: `scripts/check-production-data-directory-structure.mjs`
- Test: `scripts/check-production-data-directory-structure.mjs`

**Interfaces:**
- Consumes: repository source files and deployment documentation as text.
- Produces: a failing executable specification for `getAppDataDirectory(env, cwd)` and the required wiring/documentation.

- [ ] **Step 1: Write the failing structure test**

Create `scripts/check-production-data-directory-structure.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  dataPathSource,
  portalStoreSource,
  storyflowStoreSource,
  gitignoreSource,
  envExampleSource,
  readmeSource,
] = await Promise.all([
  read("lib/serverDataPath.ts").catch(() => ""),
  read("lib/portalStore.ts"),
  read("lib/storyflowServerStore.ts"),
  read(".gitignore"),
  read(".env.example"),
  read("README.md"),
]);

assert.match(
  dataPathSource,
  /export function getAppDataDirectory/u,
  "server data path helper must export getAppDataDirectory"
);
assert.match(
  dataPathSource,
  /APP_DATA_DIR/u,
  "server data path helper must read APP_DATA_DIR"
);
assert.match(
  dataPathSource,
  /path\.resolve/u,
  "configured data directories must resolve to absolute paths"
);
assert.match(
  dataPathSource,
  /path\.join\(cwd,\s*"data"\)/u,
  "missing APP_DATA_DIR must fall back to the project data directory"
);
assert.doesNotMatch(
  portalStoreSource,
  /path\.join\(process\.cwd\(\),\s*"data"\)/u,
  "portal store must not own its data-directory logic"
);
assert.doesNotMatch(
  storyflowStoreSource,
  /path\.join\(process\.cwd\(\),\s*"data"\)/u,
  "storyflow store must not own its data-directory logic"
);
assert.match(
  portalStoreSource,
  /getAppDataDirectory/u,
  "portal store must use the shared data-directory helper"
);
assert.match(
  storyflowStoreSource,
  /getAppDataDirectory/u,
  "storyflow store must use the shared data-directory helper"
);
assert.match(gitignoreSource, /^data\/portal-store\.json$/mu);
assert.match(gitignoreSource, /^data\/storyflow-store\.json$/mu);
assert.match(envExampleSource, /^APP_DATA_DIR=$/mu);
assert.match(readmeSource, /\/root\/english-critique-data/u);
assert.match(readmeSource, /必须先迁移数据，再拉取新代码/u);
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
node scripts/check-production-data-directory-structure.mjs
```

Expected: FAIL with `server data path helper must export getAppDataDirectory` because `lib/serverDataPath.ts` does not exist yet.

- [ ] **Step 3: Commit the failing specification**

```bash
git add scripts/check-production-data-directory-structure.mjs
git commit -m "test: specify external production data directory"
```

---

### Task 2: Centralize Runtime Data Paths

**Files:**
- Create: `lib/serverDataPath.ts`
- Modify: `lib/portalStore.ts`
- Modify: `lib/storyflowServerStore.ts`
- Test: `scripts/check-production-data-directory-structure.mjs`

**Interfaces:**
- Produces: `getAppDataDirectory(env?: NodeJS.ProcessEnv, cwd?: string): string`.
- Consumes: `process.env.APP_DATA_DIR` and `process.cwd()`.
- Both stores receive their `STORE_DIR` from `getAppDataDirectory()`.

- [ ] **Step 1: Add the minimal shared resolver**

Create `lib/serverDataPath.ts`:

```ts
import path from "path";

export function getAppDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
) {
  const configuredDirectory = env.APP_DATA_DIR?.trim();

  return configuredDirectory
    ? path.resolve(cwd, configuredDirectory)
    : path.join(cwd, "data");
}
```

- [ ] **Step 2: Wire the portal store to the resolver**

In `lib/portalStore.ts`, remove the direct `path` import, add:

```ts
import { getAppDataDirectory } from "@/lib/serverDataPath";
```

Replace:

```ts
const STORE_DIR = path.join(process.cwd(), "data");
```

with:

```ts
const STORE_DIR = getAppDataDirectory();
```

Keep `STORE_FILE`, directory creation, read, normalization, and write behavior unchanged.

- [ ] **Step 3: Wire the Storyflow store to the resolver**

In `lib/storyflowServerStore.ts`, remove the direct `path` import, add:

```ts
import { getAppDataDirectory } from "@/lib/serverDataPath";
```

Replace:

```ts
const STORE_DIR = path.join(process.cwd(), "data");
```

with:

```ts
const STORE_DIR = getAppDataDirectory();
```

Keep the rest of the store behavior unchanged so restored `aiAnimation` and `aiAnimations` associations remain intact.

- [ ] **Step 4: Run the structure test**

Run:

```bash
node scripts/check-production-data-directory-structure.mjs
```

Expected: still FAIL on the first missing `.gitignore`, `.env.example`, or README requirement. This proves the code portion passed and documentation isolation remains unfinished.

- [ ] **Step 5: Run TypeScript validation through the production build**

Run:

```bash
npm run build
```

Expected: exit code 0 and all Next.js routes compile.

- [ ] **Step 6: Commit the shared path implementation**

```bash
git add lib/serverDataPath.ts lib/portalStore.ts lib/storyflowServerStore.ts
git commit -m "feat: store production data outside deploy directory"
```

---

### Task 3: Remove Runtime Data from Git and Document Safe Migration

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `README.md`
- Remove from Git index only: `data/portal-store.json`
- Remove from Git index only: `data/storyflow-store.json`
- Test: `scripts/check-production-data-directory-structure.mjs`

**Interfaces:**
- Produces: deploy-time configuration `APP_DATA_DIR=/root/english-critique-data`.
- Produces: a first-migration procedure that protects the live JSON before Git removes tracked copies.
- Preserves: local working copies through `git rm --cached`, never filesystem deletion.

- [ ] **Step 1: Ignore runtime JSON files**

Append to `.gitignore`:

```gitignore

# Runtime application data must live outside production deploy directories.
data/portal-store.json
data/storyflow-store.json
```

- [ ] **Step 2: Add the environment variable contract**

Add near the server-only configuration section of `.env.example`:

```env
# Optional runtime JSON directory. Production should set:
# APP_DATA_DIR=/root/english-critique-data
# Empty keeps local development on <project>/data.
APP_DATA_DIR=
```

- [ ] **Step 3: Replace the unsafe update instructions**

Update the README production section to document the first migration before the ordinary update section. The commands must:

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

The accompanying warning must contain the exact sentence:

```text
首次升级必须先迁移数据，再拉取新代码。
```

Document post-start verification of users, documents, assignments, and video associations from `/root/english-critique-data`.

For later updates, retain:

```bash
cd /root/english-critique-ai-nextjs
git pull
npm install
npm run build
pm2 restart english-critique-ai --update-env
```

- [ ] **Step 4: Stop tracking the runtime files without deleting local copies**

Run:

```bash
git rm --cached data/portal-store.json data/storyflow-store.json
test -f data/portal-store.json
test -f data/storyflow-store.json
```

Expected: both `test` commands exit 0; `git status --short` shows the two paths as staged deletions while the files still exist locally and are ignored.

- [ ] **Step 5: Run the structure test**

Run:

```bash
node scripts/check-production-data-directory-structure.mjs
```

Expected: PASS with exit code 0.

- [ ] **Step 6: Verify Git no longer tracks production data**

Run:

```bash
test -z "$(git ls-files data/portal-store.json data/storyflow-store.json)"
git check-ignore data/portal-store.json data/storyflow-store.json
```

Expected: the first command exits 0; the second prints both file paths.

- [ ] **Step 7: Commit configuration and migration documentation**

```bash
git add .gitignore .env.example README.md
git commit -m "docs: protect production data during deployment"
```

The staged deletions created by `git rm --cached` are included in this commit; local ignored files remain on disk.

---

### Task 4: Full Verification and Deployment Handoff

**Files:**
- Verify: `lib/serverDataPath.ts`
- Verify: `lib/portalStore.ts`
- Verify: `lib/storyflowServerStore.ts`
- Verify: `.gitignore`
- Verify: `.env.example`
- Verify: `README.md`
- Verify: `scripts/check-production-data-directory-structure.mjs`

**Interfaces:**
- Consumes: all changes from Tasks 1–3.
- Produces: evidence that the repository is safe to push and exact instructions for the one-time production migration.

- [ ] **Step 1: Run the dedicated regression test**

```bash
node scripts/check-production-data-directory-structure.mjs
```

Expected: exit code 0.

- [ ] **Step 2: Run existing persistence structure coverage**

```bash
node scripts/check-portal-feature-settings-structure.mjs
```

Expected: exit code 0.

- [ ] **Step 3: Run whitespace and patch validation**

```bash
git diff --check HEAD~3
```

Expected: no output and exit code 0.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: exit code 0 with successful Next.js compilation.

- [ ] **Step 5: Verify repository data isolation**

```bash
test -z "$(git ls-files data/portal-store.json data/storyflow-store.json)"
git check-ignore data/portal-store.json data/storyflow-store.json
git status --short
```

Expected: the runtime files are not tracked, both are ignored, and no unintended account/video data appears in the working tree.

- [ ] **Step 6: Review the final commit range**

```bash
git log --oneline -4
git diff HEAD~3..HEAD --stat
```

Expected: only the specification, test, path resolver, store wiring, ignore rules, environment example, README, and tracked-file removals are included.

- [ ] **Step 7: Hand off the first production migration**

Provide the user the exact README migration block and emphasize:

```text
Do not run git pull on production until the live JSON files have been copied to
/root/english-critique-data and APP_DATA_DIR has been added to .env.production.
```

Do not push or deploy automatically unless the user separately authorizes those external actions.
