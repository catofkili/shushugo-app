// 例句和开口练习共用：振假名校验 → 明确假名 → 短语级句调迁移 → VOICEVOX。
// 助词位和长音判据仍在 voicevox-reading.mjs；重算拍表后才迁移句调，避免被覆盖。
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { queryMoras, pronunciationMismatch, explicitKanaNotation, intendedReading, kanaSubstituted } from "./voicevox-reading.mjs";
import { referenceWav, trackF0, transferPhraseContour } from "./prosody-transfer.mjs";

// 1.3 是例句实听定的：1.0 偏平，1.7 开始「演」。
const PROSODY_STRENGTH = Number(process.env.PROSODY_STRENGTH ?? "1.3");

// —— VOICEVOX ——
async function voicevoxQuery(text, host, speaker) {
  const response = await fetch(`${host}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: "POST" });
  if (!response.ok) throw new Error(`audio_query HTTP ${response.status}`);
  return response.json();
}
async function voicevoxAccentPhrases(kanaNotation, host, speaker) {
  const response = await fetch(
    `${host}/accent_phrases?text=${encodeURIComponent(kanaNotation)}&speaker=${speaker}&is_kana=true`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error(`accent_phrases HTTP ${response.status}`);
  return response.json();
}

export class NeedsReview extends Error {
  constructor(reason, query, intended) {
    super(reason);
    this.engine = queryMoras(query).map((m) => m.text).join("");
    this.intended = intended?.morae.join("") ?? null;
  }
}

export async function voicevoxSynthesize(item, {
  speak = {}, useProsody = true,
  host = process.env.VOICEVOX_HOST ?? "http://127.0.0.1:50021",
  speaker = Number(process.env.VOICEVOX_SPEAKER ?? "8")
} = {}) {
  const intended = intendedReading(item);
  // 人判给了替代文本就直接用它;校不了的句子照引擎的读法
  let query = await voicevoxQuery(speak[item.text] ?? item.text, host, speaker);
  let verified = false;
  let locked = false;
  let substituted = false;
  if (intended) {
    let mismatch = pronunciationMismatch(query, intended.morae, intended.particles);
    if (mismatch && queryMoras(query).length !== intended.morae.length && !speak[item.text]) {
      // 拍数一致就能锁,不一致换个喂法再试一次
      const retry = await voicevoxQuery(kanaSubstituted(item), host, speaker);
      query = retry;
      mismatch = pronunciationMismatch(query, intended.morae, intended.particles);
      substituted = true;
    }
    if (mismatch && queryMoras(query).length !== intended.morae.length) {
      throw new NeedsReview(`${mismatch}`, query, intended);
    }
    locked = Boolean(mismatch);
    const notation = explicitKanaNotation(query, null, intended.morae, intended.particles);
    query.accent_phrases = await voicevoxAccentPhrases(notation, host, speaker);
    query.kana = notation;
    mismatch = pronunciationMismatch(query, intended.morae, intended.particles);
    if (mismatch) throw new NeedsReview(`明确假名校验失败:${mismatch}`, query, intended);
    verified = true;
  }
  // 迁移必须放在 accent_phrases 重算之后:那一步会换掉整份拍表,先写就被覆盖了。
  let prosody = 0;
  if (useProsody) prosody = transferPhraseContour(query, trackF0(await referenceWav(item.text)), PROSODY_STRENGTH);
  query.prePhonemeLength = 0.02;
  query.postPhonemeLength = 0.05;
  query.outputSamplingRate = 24000;
  query.outputStereo = false;
  const response = await fetch(`${host}/synthesis?speaker=${speaker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query)
  });
  if (!response.ok) throw new Error(`synthesis HTTP ${response.status}`);
  return { wav: Buffer.from(await response.arrayBuffer()), verified, prosody, locked, substituted, engineReading: queryMoras(query).map((m) => m.text).join("") };
}

export function toAac(wav, targetPath, bitrate = 24000) {
  const temp = `${targetPath}.wav`;
  writeFileSync(temp, wav);
  try {
    execFileSync("afconvert", ["-f", "adts", "-d", "aac", "-b", String(bitrate), temp, targetPath], { stdio: "pipe" });
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

