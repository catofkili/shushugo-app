// 开口练习（实验功能）小程序预览版的场景图：study 分包上限 2 MiB，30 张 800×600 原图（约 2.2 MB）自己就放不下。
// 只在 SHUSHUGO_EXP_TALK=1 构建时由 config/index.js 调用，压成 480×360（每张约 25 KB） 放进 .talk-scenes-weapp/（gitignore），网页仍用原图。
// ponytail: 用 macOS 自带的 sips；没有 sips（Linux）就原样拷，超了由 verify-package-gates 拦。上线时场景图改走云存储（DAILY_TALK_SPEC §7），这个脚本就删。
const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } = require('node:fs');
const path = require('node:path');

module.exports = function talkScenesForWeapp(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).filter((file) => file.endsWith('.jpg'))) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) continue;
    try {
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '50', '-Z', '480', source, '--out', target], { stdio: 'ignore' });
    } catch {
      copyFileSync(source, target);
    }
  }
  return to;
};
