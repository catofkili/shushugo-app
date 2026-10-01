#!/usr/bin/env node
// 完整句子只放实验功能 src/assets；合成、助词校验、句调、编码均复用例句管线。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { exampleAudioName } from "../src/lib/speech-audio.ts";
import { talkAudioSentences } from "../src/lib/talk/sentences.ts";
import { NeedsReview, voicevoxSynthesize, toAac } from "./voicevox-synth.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const content = readJson(join(root, "src/data/talk_content.json"));
const ruby = readJson(join(root, "src/data/talk_furigana.json"));
const outputDir = join(root, "src/assets/talk-audio/voicevox-8");
const reviewPath = join(root, "scripts/talk-audio-review.json");
const review = existsSync(reviewPath) ? readJson(reviewPath) : { pending: {}, speak: {} };
// accepted：人判过「引擎读法就是对的」的句子（注音盖不住的字母），不再回到 pending。
review.accepted ??= {};
const items = talkAudioSentences(content).map((text) => {
  assert.ok(Object.hasOwn(ruby, text), `注音缺失，请先重跑 build-talk-furigana.mjs：${text}`);
  // talk 用 UTF-16 对象区间；例句管线用码点三元组，不把偏移单位混用。
  const furigana = ruby[text].map(({ start, length, reading }) => [
    [...text.slice(0, start)].length, [...text.slice(start, start + length)].length, reading
  ]);
  return { text, furigana };
});
const fileNameFor = ({ text }) => `${exampleAudioName(text)}.aac`;
const expected = new Set(items.map(fileNameFor));
assert.equal(expected.size, items.length, "音频哈希碰撞");
mkdirSync(outputDir, { recursive: true });
const missing = items.filter((item) => !existsSync(join(outputDir, fileNameFor(item))));
console.log(`会话 ${items.length} 句，已存在 ${items.length - missing.length} 句，待合成 ${missing.length} 句`);
if (process.argv.includes("--dry-run")) process.exit(0);

// 打开 App 后等引擎，不假设 GUI 一出现 HTTP 就已就绪。仅连接本机。
const host = "http://127.0.0.1:50021";
execFileSync("open", ["-a", "VOICEVOX"]);
const deadline = Date.now() + 120_000;
while (true) {
  try {
    const response = await fetch(`${host}/version`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) { console.log(`VOICEVOX ${await response.json()} 已就绪`); break; }
  } catch { /* 启动期间短暂拒绝连接，继续轮询。 */ }
  if (Date.now() >= deadline) throw new Error("VOICEVOX 两分钟内未就绪");
  await setTimeout(1000);
}
const concurrency = Number(process.env.VOICEVOX_CONCURRENCY ?? "2");
assert.ok(Number.isInteger(concurrency) && concurrency > 0, "VOICEVOX_CONCURRENCY 必须为正整数");
const queue = [...missing];
let done = 0, locked = 0, substituted = 0, prosody = 0, failed = 0, orphans = 0;
const saveReview = () => writeFileSync(reviewPath, JSON.stringify(review, null, 2) + "\n");
async function worker() {
  while (queue.length) {
    const item = queue.shift();
    try {
      const result = await voicevoxSynthesize(item, { speak: review.speak, host, speaker: 8 });
      toAac(result.wav, join(outputDir, fileNameFor(item)));
      done += 1;
      locked += Number(result.locked);
      substituted += Number(result.substituted);
      prosody += Number(result.prosody > 0);
      if (result.verified || review.accepted[item.text]) delete review.pending[item.text];
      else review.pending[item.text] = {
        engine: result.engineReading, intended: null,
        reason: "注音盖不住字母，沿用例句管线按引擎读法合成；请逐条试听确认",
        hint: "Claude 判读音；当前注音只覆盖汉字，M/ATM/A/B 没有完整标准读音"
      };
      if (done === 1 || done % 25 === 0) console.log(`  合成 ${done}/${missing.length}：${item.text}`);
    } catch (error) {
      if (error instanceof NeedsReview) {
        review.pending[item.text] = { engine: error.engine, intended: error.intended, reason: error.message,
          hint: "Claude 逐条判；在 speak 写替代文本（把读错的字换成假名）后重跑" };
      } else {
        failed += 1;
        console.error(`  ✗ ${item.text}：${error.message}`);
      }
    }
    // 每句保存人判队列，进程中断也不丢掉已发现的问题。
    saveReview();
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
for (const name of readdirSync(outputDir)) if (name.endsWith(".aac") && !expected.has(name)) {
  unlinkSync(join(outputDir, name)); orphans += 1;
}
for (const text of Object.keys(review.pending)) if (!items.some((item) => item.text === text)) delete review.pending[text];
saveReview();
const generated = items.filter((item) => existsSync(join(outputDir, fileNameFor(item))));
writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(Object.fromEntries(generated.map((item) => [fileNameFor(item), item.text])), null, 2) + "\n");
const bytes = generated.reduce((sum, item) => sum + statSync(join(outputDir, fileNameFor(item))).size, 0);
console.log(`完成：合成 ${done} / 锁回 ${locked} / 换假名 ${substituted} / pending ${Object.keys(review.pending).length} / 句调迁移 ${prosody} / 失败 ${failed} / 孤儿 ${orphans}`);
console.log(`音频 ${generated.length}/${items.length}，总大小 ${bytes} bytes（${(bytes / 1024 / 1024).toFixed(2)} MiB）`);
if (failed) process.exitCode = 1;
