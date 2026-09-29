// 决定「读音」按钮把什么文本交给语音合成。
//
// 两条铁律,都是被具体 bug 打出来的:
//
// 1. **只喂这张卡自己的假名,永不喂汉字表记**。喂汉字时引擎按自己的词典挑读音:
//    誠 挑音读 セイ 而不是卡片上的 まこと,角 挑 カク 而不是 かど —— 音训两读的
//    单字全是雷。
//
// 2. **喂片假名,不喂平假名**。平假名串会被引擎当句子做形态分析,自行切词:
//      はいざら → は|いざら   (は 当助词,灰皿 读成「wa izara」)
//      だいたい → だ|いたい   (だ 当系动词,大体 读成「da itai」)
//    这类切错无法枚举,靠列规则堵是堵不完的。片假名没有这个问题:助词、系动词
//    都只写平假名,而片假名每个字的读音唯一,引擎再怎么切词音素都不变 ——
//    这是把「读什么」的决定权从引擎手里彻底拿回来的唯一办法。
//
// 代价是语调:片假名串可能拿不到词典里的声调型,听感比平假名平一点。但「读成另一个
// 词」比「语调略平」严重得多。真遇到某个词语调难听,该加的是单词级读音覆盖表,
// 不是把决定权还给引擎。
//
// 唯一的例外是词尾真·助词:こんにちは 的 は 本来就读 wa,直接转成 ハ 会读错。
// 判据不靠猜 —— 表记(kanji 列)也以同一个假名结尾时才算助词:
//   実は  / じつは → 表记以 は 收尾 → 助词 → ジツワ
//   母   / はは   → 表记是「母」   → 词的一部分 → ハハ
//   木の葉 / このは → 表记以「葉」收尾 → 词的一部分 → コノハ

/** 词库表记里夹着 〜出す 的波浪号、濡[ぬ]れる 的注音方括号,读之前先剥掉。
 *  波浪号三种写法都有(全角 〜、全角 ～、半角 ~),词库里混着用。 */
const clean = (text: string) => text.replace(/\[[^\]]*\]/g, "").replace(/[〜～~\s]/g, "");

const toKatakana = (text: string) =>
  text.replace(/[ぁ-ゖ]/g, (char) => String.fromCodePoint((char.codePointAt(0) ?? 0) + 0x60));

/** 词尾助词的实际读音 */
const PARTICLE_SOUND: Record<string, string> = { は: "ワ", へ: "エ", を: "オ" };

/**
 * VOICEVOX 的普通文本解析会区分平假名和片假名。这里保留词库原本的书写，只清理
 * 注音标记；不能复用 speechText 的全片假名结果，否则「ユシュツ」会被误拆成
 * 「ユ/シュッ」。系统 TTS 和 VOICEVOX 因此必须走两条不同的输入路径。
 */
export function pronunciationReading(kana: string): string {
  return clean(kana);
}

export function speechText(kanji: string, kana: string): string {
  const reading = pronunciationReading(kana);
  if (!reading) return reading;

  const chars = [...reading];
  const last = chars[chars.length - 1];
  const isParticle = chars.length > 1 && last in PARTICLE_SOUND && clean(kanji).endsWith(last);

  return isParticle
    ? toKatakana(chars.slice(0, -1).join("")) + PARTICLE_SOUND[last]
    : toKatakana(reading);
}

/**
 * 音频文件名 = 「表记|假名」的 FNV-1a 64 位哈希。
 *
 * 为什么按词而不是按读音:箸 和 橋 读音都是 ハシ,但重音一个 1 型一个 2 型,合成出来
 * 的音频不是一回事,共用一个文件就会教错音。按词建文件多花约 12% 的磁盘,换绝对不会串。
 *
 * 为什么用哈希而不是假名本身:URL 里的假名会被服务端解码后再查磁盘,而 macOS 存文件名
 * 用 NFD(ダ = タ+゛)、Linux 服务器按 NFC 查找,同一个名字两边对不上就白白 404。
 * 纯 ASCII 哈希绕开整个归一化问题。64 位在一万条量级上碰撞概率约 3e-12。
 */
const fnv64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

export function pronunciationAudioName(kanji: string, kana: string): string {
  return fnv64(`${kanji}|${kana}`);
}

/** 例句音频的文件名 = 句子原文的哈希。改一句只换一个文件,旧的当孤儿清掉。 */
export function exampleAudioName(sentence: string): string {
  return fnv64(sentence.trim());
}
