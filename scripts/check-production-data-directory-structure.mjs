import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (filePath) =>
  readFile(new URL(`../${filePath}`, import.meta.url), "utf8");

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
assert.match(readmeSource, /首次升级必须先迁移数据，再拉取新代码/u);
