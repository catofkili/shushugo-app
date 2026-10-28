// 五十音读音：46 个音（平片同音共用一条），本机 VOICEVOX 合成，进 git、随网页和 Taro study 分包发。
// 不走云端音频包：线上网页不取音频包（2026-10-13 作者定），那样五十音在网页上就没声音；
// 46 条、约 300 KB，直接带上最省事。用法：先开 VOICEVOX.app，再 `node scripts/build-kana-audio.mjs`。
//
// 为什么和单词读音的参数不一样（「五十音是基础，读音要清楚」，2026-10-28 用户要求）：
// - 64 kbps，不是音频包的 24 kbps（作者听过 24 kbps 偏糊；这里只有 46 条，码率不是问题）。
// - 单拍元音拉到 0.32 秒以上：VOICEVOX 默认单念一个假名元音只有 0.15–0.21 秒，听着像被掐断。
//   不拉更长，否则像长音「あー」，和后面要学的长音混。
// - 用假名记法指定读音，合成前再核对引擎读出来的拍（を 要读 オ、は 要读 ハ），不一致就停。
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.VOICEVOX_HOST ?? "http://127.0.0.1:50021";
const SPEAKER = Number(process.env.VOICEVOX_SPEAKER ?? "8"); // 春日部つむぎ，和默认免费声音 voicevox-8 同一个
const BITRATE = 64000;
const MIN_VOWEL = 0.32;
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/assets/kana-audio");

const SOUNDS = [
  ["あ","a"],["い","i"],["う","u"],["え","e"],["お","o"],["か","ka"],["き","ki"],["く","ku"],["け","ke"],["こ","ko"],
  ["さ","sa"],["し","shi"],["す","su"],["せ","se"],["そ","so"],["た","ta"],["ち","chi"],["つ","tsu"],["て","te"],["と","to"],
  ["な","na"],["に","ni"],["ぬ","nu"],["ね","ne"],["の","no"],["は","ha"],["ひ","hi"],["ふ","fu"],["へ","he"],["ほ","ho"],
  ["ま","ma"],["み","mi"],["む","mu"],["め","me"],["も","mo"],["や","ya"],["ゆ","yu"],["よ","yo"],["ら","ra"],["り","ri"],
  ["る","ru"],["れ","re"],["ろ","ro"],["わ","wa"],["を","wo"],["ん","n"]
];
// 引擎应读出的拍（片假名）。を 现代只读 オ。
const toKatakana = (kana) => kana === "を" ? "オ" : String.fromCharCode(kana.charCodeAt(0) + 0x60);

const post = async (path, body) => {
  const response = await fetch(`${HOST}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response;
};

mkdirSync(out, { recursive: true });
const tmp = join(out, ".tmp.wav");
const report = [];
for (const [kana, romaji] of SOUNDS) {
  const query = await (await post(`/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(kana)}`)).json();
  // 用假名记法（AquesTalk 风格，is_kana）指定拍，不让引擎按文本猜：单独一个 は 它会当助词读成 ワ。
  query.accent_phrases = await (await post(`/accent_phrases?speaker=${SPEAKER}&is_kana=true&text=${encodeURIComponent(`${toKatakana(kana)}'`)}`)).json();
  const moras = query.accent_phrases.flatMap((phrase) => phrase.moras);
  const heard = moras.map((mora) => mora.text).join("");
  if (heard !== toKatakana(kana)) throw new Error(`${kana}: 引擎读成 ${heard}，应为 ${toKatakana(kana)}`);
  for (const mora of moras) mora.vowel_length = Math.max(mora.vowel_length, MIN_VOWEL);
  Object.assign(query, { speedScale: 1, prePhonemeLength: 0.05, postPhonemeLength: 0.12, outputStereo: false });
  writeFileSync(tmp, Buffer.from(await (await post(`/synthesis?speaker=${SPEAKER}`, query)).arrayBuffer()));
  const target = join(out, `${romaji}.aac`);
  execFileSync("afconvert", ["-f", "adts", "-d", "aac", "-b", String(BITRATE), "-s", "0", tmp, target]); // -s 0 = 恒定码率，不让编码器对短音频自降
  report.push(`${kana} ${romaji.padEnd(3)} ${heard} ${statSync(target).size} B`);
}
rmSync(tmp);
console.log(report.join("\n"));
