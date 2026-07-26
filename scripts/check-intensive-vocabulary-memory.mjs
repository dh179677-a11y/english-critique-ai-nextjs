import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import ts from "typescript";

const source = await readFile(
  new URL("../lib/intensiveVocabularyMemory.ts", import.meta.url),
  "utf8"
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  buildPreviouslyTaughtVocabulary,
  formatPreviouslyTaughtVocabularyPrompt,
  normalizeIntensiveVocabularyFamily,
} = await import(moduleUrl);

assert.equal(normalizeIntensiveVocabularyFamily("Spots!"), "spot");
assert.equal(normalizeIntensiveVocabularyFamily("came"), "come");
assert.equal(normalizeIntensiveVocabularyFamily("Children"), "child");
assert.equal(normalizeIntensiveVocabularyFamily("climbed"), "climb");
assert.equal(normalizeIntensiveVocabularyFamily("the"), "");
assert.equal(normalizeIntensiveVocabularyFamily("RIGHT"), "");

const pages = [
  { keyVocabulary: ["Naughty", "children", "the"] },
  { keyVocabulary: ["Two", "children", "came"] },
  { keyVocabulary: ["They", "climbed", "spots"] },
];

assert.deepEqual(buildPreviouslyTaughtVocabulary(pages, 0), []);
assert.deepEqual(buildPreviouslyTaughtVocabulary(pages, 1), [
  { family: "child", forms: ["children"], lastPageIndex: 0 },
  { family: "naughty", forms: ["Naughty"], lastPageIndex: 0 },
]);

const pageThreeMemory = buildPreviouslyTaughtVocabulary(pages, 2);
assert.equal(
  pageThreeMemory.filter((entry) => entry.family === "child").length,
  1
);
assert.ok(pageThreeMemory.some((entry) => entry.family === "come"));
assert.ok(!pageThreeMemory.some((entry) => entry.family === "the"));

const prompt = formatPreviouslyTaughtVocabularyPrompt(pageThreeMemory);
assert.match(prompt, /此前已经精讲的词族/u);
assert.match(prompt, /child（此前形式：children）/u);
assert.match(
  prompt,
  /不得重复词性、完整词义列表、常见搭配、发音拆解或生活例句/u
);

console.log("Intensive vocabulary memory normalizes and deduplicates prior-page word families.");
