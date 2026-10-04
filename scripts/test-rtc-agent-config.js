const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "lib", "volcRtcAgent.ts"),
  "utf8"
);

assert.match(source, /const version = "2024-12-01"/);
assert.match(source, /Mode: "smallmodel"/);
assert.match(source, /AppId: config\.speechAppId/);
assert.match(source, /Cluster: "volcengine_streaming_common"/);
assert.match(source, /EndPointId: config\.arkEndpointId/);
assert.doesNotMatch(source, /LLMConfig:\s*{[\s\S]*?ModelName:/);
assert.match(source, /VisionConfig:\s*{\s*Enable: false/s);
assert.match(source, /SubtitleMode: 1/);
assert.match(source, /appid: config\.speechAppId/);
assert.match(source, /token: config\.speechToken/);
assert.match(source, /voice_type: config\.ttsVoiceType/);
assert.match(source, /ResourceId: "volc\.service_type\.10029"/);
assert.match(source, /EnableConversationStateCallback: true/);
assert.match(source, /ServerMessageURLForRTS:/);
assert.match(source, /ResponseMetadata[\s\S]*?Error/);

console.log("RTC agent config matches the working ordinary-RTC compatibility profile.");

for (const componentPath of [
  "components/student/AgentStudyClient.tsx",
  "components/student/StoryflowTaskPlayer.tsx",
]) {
  const componentSource = fs.readFileSync(
    path.join(__dirname, "..", componentPath),
    "utf8"
  );
  assert.doesNotMatch(componentSource, /await start(?:Coach)?RtcVisualTrack\(engine/);
}

console.log("RTC student clients publish audio only.");
