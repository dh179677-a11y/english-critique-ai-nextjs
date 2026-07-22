import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const appSource = await readFile(new URL("../App.tsx", import.meta.url), "utf8");

assert.match(
  loginSource,
  /const \[showPassword,\s*setShowPassword\] = useState\(false\)/u,
  "login page must keep local show/hide password state"
);
assert.match(
  loginSource,
  /type=\{showPassword \? "text" : "password"\}/u,
  "login password input must switch between text and password types"
);
assert.match(
  loginSource,
  /onClick=\{\(\) => setShowPassword\(\(current\) => !current\)\}/u,
  "login page must expose a password visibility toggle button"
);
assert.match(
  loginSource,
  /showPassword \? "隐藏" : "显示"/u,
  "login password toggle must use clear Chinese labels"
);
assert.match(
  appSource,
  /鲁ICP备2026012101号-1/u,
  "student homepage must show the ICP filing number"
);
assert.match(
  loginSource,
  /<\/section>[\s\S]*<footer[\s\S]*鲁ICP备2026012101号-1[\s\S]*<\/footer>/u,
  "login page must show the ICP filing number at the bottom after the login card"
);
for (const [label, source] of [
  ["student homepage", appSource],
  ["login page", loginSource],
]) {
  assert.match(
    source,
    /href="https:\/\/beian\.miit\.gov\.cn\/"[\s\S]*鲁ICP备2026012101号-1/u,
    `${label} ICP filing number must link to MIIT`
  );
  assert.match(
    source,
    /日常咨询：小红书 @英爸/u,
    `${label} footer must show Xiaohongshu consultation contact`
  );
  assert.match(
    source,
    /href="mailto:sakurasa1984@hotmail\.com"[\s\S]*联系我们：sakurasa1984@hotmail\.com/u,
    `${label} footer must show the email contact link`
  );
}
