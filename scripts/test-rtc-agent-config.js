const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "lib", "volcRtcAgent.ts"),
  "utf8"
);

assert.match(source, /const version = "2025-06-01"/);
assert.match(source, /Credential:\s*{\s*ApiResourceId: "volc\.seedasr\.sauc\.duration"/s);
assert.doesNotMatch(source, /LLMConfig:\s*{[\s\S]*?BotId:/);
assert.match(source, /Prefill: false/);
assert.match(source, /SubtitleMode: 1/);
assert.match(source, /EnableConversationStateCallback: false/);
assert.match(source, /VoicePrint:\s*{\s*Mode: 0/s);
assert.match(source, /ICL_zh_female_lingdongxinxin_cs_tob/);

console.log("RTC agent config matches the conversational AI console template.");
