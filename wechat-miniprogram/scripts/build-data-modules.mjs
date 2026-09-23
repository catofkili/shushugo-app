// 微信的 require 只认 .js，不认 .json。data/*.json 是源（其中 kanji_orthography.json
// 要和 iOS 端逐字节一致），这里给每份生成同名 .js 到 src/data/ 包一层 module.exports；
// 页面和 runtime 只 require 生成出来的 .js。改了 json 就重跑一次；`npm run check` 会核对两边一致。
// ⚠️ 源 json 放在 src/ 外面：放里面会被开发者工具一起打进主包（pitch_accent 一份就 266 KiB），
// 主包 2 MiB 的上限已经很紧。
import fs from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve(import.meta.dirname, '..', 'data');
const dir = path.resolve(import.meta.dirname, '..', 'src', 'data');
export const moduleSource = (json) => `// 由 scripts/build-data-modules.mjs 从同名 .json 生成，别手改。\nmodule.exports = ${json.trim()};\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith('.json'))) {
    fs.writeFileSync(path.join(dir, file.replace(/\.json$/, '.js')), moduleSource(fs.readFileSync(path.join(sourceDir, file), 'utf8')));
    console.log(`wrote src/data/${file.replace(/\.json$/, '.js')}`);
  }
}
