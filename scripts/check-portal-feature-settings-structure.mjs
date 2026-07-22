import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const teacherSource = await readFile(new URL("../app/teacher/page.tsx", import.meta.url), "utf8");
const portalApiSource = await readFile(
  new URL("../app/api/portal/route.ts", import.meta.url),
  "utf8"
);
const portalStoreSource = await readFile(
  new URL("../lib/portalStore.ts", import.meta.url),
  "utf8"
);
const settingsSource = await readFile(
  new URL("../lib/portalFeatureSettings.ts", import.meta.url),
  "utf8"
).catch(() => "");

assert.match(
  settingsSource,
  /DEFAULT_PORTAL_FEATURE_SETTINGS[\s\S]*isSelfPracticeVisible:\s*false/u,
  "口语自测评分 must be hidden by default"
);
assert.match(
  settingsSource,
  /savePortalFeatureSettings/u,
  "portal feature settings must expose a save helper"
);
assert.match(
  settingsSource,
  /hydratePortalFeatureSettings[\s\S]*getPortalFeatureSettings/u,
  "student homepage must be able to hydrate feature settings from the server"
);
assert.match(
  settingsSource,
  /persistPortalFeatureSettings[\s\S]*setPortalFeatureSettings/u,
  "teacher dashboard must persist feature settings to the server"
);
assert.match(
  settingsSource,
  /subscribePortalFeatureSettings/u,
  "portal feature settings must notify open student pages when teachers toggle visibility"
);
assert.match(
  appSource,
  /getPortalFeatureSettings/u,
  "student homepage must read portal feature settings"
);
assert.match(
  appSource,
  /subscribePortalFeatureSettings/u,
  "student homepage must react to teacher visibility changes"
);
assert.match(
  appSource,
  /portalFeatureSettings\.isSelfPracticeVisible\s*\?\s*\(/u,
  "student homepage must conditionally render the 口语自测评分 card"
);
assert.match(
  teacherSource,
  /getPortalFeatureSettings/u,
  "teacher dashboard must read portal feature settings"
);
assert.match(
  teacherSource,
  /persistPortalFeatureSettings/u,
  "teacher dashboard must save portal feature settings"
);
assert.match(
  teacherSource,
  /学生端功能开关[\s\S]*口语自测评分/u,
  "teacher dashboard must expose a student-side visibility control for 口语自测评分"
);
assert.match(
  portalApiSource,
  /"getPortalFeatureSettings"[\s\S]*"setPortalFeatureSettings"/u,
  "portal API must expose get/set actions for feature settings"
);
assert.match(
  portalApiSource,
  /case "getPortalFeatureSettings"[\s\S]*case "setPortalFeatureSettings"/u,
  "portal API must route get/set feature settings actions"
);
assert.match(
  portalStoreSource,
  /featureSettings:\s*PortalFeatureSettings/u,
  "portal store must persist feature settings with the shared data"
);
assert.match(
  portalStoreSource,
  /featureSettings:\s*DEFAULT_PORTAL_FEATURE_SETTINGS/u,
  "portal store must default feature settings safely"
);
