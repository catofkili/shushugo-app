import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import { normalizeInput, splitMoras, toHiragana } from "./kana";
import { kanaToRomaji, matchRomaji, ROMAJI_PARTICLE_WORDS } from "./romaji";

type CorpusWord = { id: number; kanji: string; kana: string };
let db: Database;
let corpus: CorpusWord[];

beforeAll(async () => {
  const SQL = await initSqlJs();
  db = new SQL.Database(new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/nihongo.db", import.meta.url)))));
  corpus = db.exec("SELECT id, kanji, kana FROM words ORDER BY id")[0].values.map(([id, kanji, kana]) => ({
    id: Number(id), kanji: String(kanji), kana: String(kana)
  }));
});

afterAll(() => db?.close());

const TEST_BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "o",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
  ゕ: "ka", ゖ: "ke", ゔ: "vu"
};
const TEST_KUNREI: Record<string, string> = { し: "si", ち: "ti", つ: "tu", ふ: "hu", じ: "zi", ぢ: "di", づ: "du" };
const TEST_COMPOUNDS: Record<string, string> = {
  てぃ: "thi", でぃ: "di", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  うぁ: "wa", うぃ: "wi", うぇ: "we", うぉ: "wo", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", ゔゅ: "vyu",
  しぇ: "she", じぇ: "je", ちぇ: "che", つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  てゅ: "tyu", とぅ: "twu", でゅ: "dyu", どぅ: "dwu", ぢゃ: "dya", ぢゅ: "dyu", ぢょ: "dyo"
};
const TEST_YOON: Record<string, Record<string, string>> = {
  し: { a: "sha", u: "shu", o: "sho" },
  ち: { a: "cha", u: "chu", o: "cho" },
  じ: { a: "ja", u: "ju", o: "jo" }
};
const TEST_SMALL = new Set([...
  "ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶ"
]);
const TEST_VOWEL: Record<string, string> = {
  あ: "a", か: "a", さ: "a", た: "a", な: "a", は: "a", ま: "a", や: "a", ら: "a", わ: "a", が: "a", ざ: "a", だ: "a", ば: "a", ぱ: "a",
  い: "i", き: "i", し: "i", ち: "i", に: "i", ひ: "i", み: "i", り: "i", ぎ: "i", じ: "i", ぢ: "i", び: "i", ぴ: "i",
  う: "u", く: "u", す: "u", つ: "u", ぬ: "u", ふ: "u", む: "u", ゆ: "u", る: "u", ぐ: "u", ず: "u", づ: "u", ぶ: "u", ぷ: "u", ゔ: "u",
  え: "e", け: "e", せ: "e", て: "e", ね: "e", へ: "e", め: "e", れ: "e", げ: "e", ぜ: "e", で: "e", べ: "e", ぺ: "e",
  お: "o", こ: "o", そ: "o", と: "o", の: "o", ほ: "o", も: "o", よ: "o", ろ: "o", ご: "o", ぞ: "o", ど: "o", ぼ: "o", ぽ: "o",
  ぁ: "a", ゃ: "a", ゎ: "a", ぃ: "i", ぅ: "u", ゅ: "u", ぇ: "e", ぉ: "o", ょ: "o"
};
const TEST_VOWEL_KANA: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };
const MARKERS = /[〜～~・]/gu;

const independentHiragana = (kana: string): string => [...kana].map((char) => {
  const point = char.charCodeAt(0);
  return point >= 0x30a1 && point <= 0x30f6 ? String.fromCharCode(point - 0x60) : char;
}).join("");

const independentMoras = (kana: string): string[] => {
  const out: string[] = [];
  for (const char of independentHiragana(kana)) {
    const previous = out[out.length - 1];
    if (TEST_SMALL.has(char) && previous && !/^[っんー]/u.test(previous)) out[out.length - 1] = previous + char;
    else out.push(char);
  }
  return out;
};

const testVowelOf = (mora: string): string => TEST_VOWEL[independentHiragana(mora).slice(-1)] ?? "";
const testLongContinuation = (previous: string, mora: string): boolean => {
  const vowel = testVowelOf(previous);
  return !!vowel && (mora === TEST_VOWEL_KANA[vowel] || (vowel === "o" && mora === "う") || (vowel === "e" && mora === "い") || mora === "ー");
};

type GeneratorStyle = "hepburn" | "nihon" | "ime";
const independentMoraSpelling = (mora: string, style: GeneratorStyle): string => {
  if (TEST_COMPOUNDS[mora]) return TEST_COMPOUNDS[mora];
  const chars = [...mora];
  if (chars.length === 2 && ["ゃ", "ゅ", "ょ"].includes(chars[1])) {
    const vowel = chars[1] === "ゃ" ? "a" : chars[1] === "ゅ" ? "u" : "o";
    const special = TEST_YOON[chars[0]]?.[vowel];
    if (special) {
      if (style === "nihon" && chars[0] === "し") return `s${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      if (style === "nihon" && chars[0] === "ち") return `t${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      if (style === "nihon" && chars[0] === "じ") return `z${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}`;
      return special;
    }
    const base = TEST_BASE[chars[0]] ?? "";
    const stem = base.endsWith("i") ? base.slice(0, -1) : "";
    return stem ? `${stem}${chars[1] === "ゃ" ? "ya" : chars[1] === "ゅ" ? "yu" : "yo"}` : mora;
  }
  const base = TEST_BASE[chars[0]] ?? mora;
  return style === "nihon" ? TEST_KUNREI[chars[0]] ?? base : base;
};

const independentGemination = (spelling: string): string => {
  if (spelling.startsWith("ch")) return `t${spelling}`;
  if (spelling.startsWith("sh")) return `s${spelling}`;
  if (spelling.startsWith("ts")) return `t${spelling}`;
  return /^[bcdfghjklmnpqrstvwxyz]/u.test(spelling) ? `${spelling[0]}${spelling}` : "xtu";
};

/** 测试用独立转写器：自带字符表和组合规则，不调用生产拍切分、罗马音生成或候选表。 */
const independentRomaji = (rawKana: string, style: GeneratorStyle): string => {
  const kana = independentHiragana(rawKana.normalize("NFKC").replace(MARKERS, "").replace(/\s+/gu, ""));
  const moras = independentMoras(kana);
  let result = "";
  let previousVowel = "";
  for (let i = 0; i < moras.length; i += 1) {
    const mora = moras[i];
    if (mora === "ー") {
      result += style === "ime" ? "-" : previousVowel;
      continue;
    }
    if (mora === "っ") {
      if (style === "ime") result += "xtu";
      else if (moras[i + 1]) {
        result += independentGemination(independentMoraSpelling(moras[i + 1], style));
        previousVowel = testVowelOf(moras[i + 1]);
        i += 1;
      } else result += "xtu";
      continue;
    }
    if (mora === "ん") {
      const next = moras[i + 1];
      const nextHira = next ? independentHiragana(next) : "";
      result += style !== "hepburn" ? "nn" : /^[あいうえおやゆよ]/u.test(nextHira) ? "n'" : "n";
      continue;
    }
    const spelling = independentMoraSpelling(mora, style);
    result += spelling;
    const lastKana = independentHiragana(mora).slice(-1);
    previousVowel = TEST_VOWEL[lastKana] ?? (/[aeiou]$/u.test(spelling) ? spelling.slice(-1) : previousVowel);
  }
  return result;
};

const reportFor = (target: string, input: string) => matchRomaji(target, input).problems[0]?.code;

describe("罗马音逐拍匹配", () => {
  it("按目标接受常见拼法、外来音、长音和助词读法", () => {
    for (const spelling of ["thi", "ti"]) expect(matchRomaji("ティ", spelling).ok, `${spelling} for ティ`).toBe(true);
    expect(matchRomaji("ティ", "chi").ok).toBe(false);
    expect(matchRomaji("し", "shi").ok).toBe(true);
    expect(matchRomaji("し", "si").ok).toBe(true);
    expect(matchRomaji("ち", "ti").ok).toBe(true);
    expect(matchRomaji("ぢ", "di").ok).toBe(true);
    expect(matchRomaji("づ", "du").ok).toBe(true);
    expect(matchRomaji("ず", "du").ok).toBe(false);
    expect(matchRomaji("こんにちは", "konnichiwa").ok).toBe(true);
    expect(matchRomaji("このは", "konowa").ok).toBe(false);
  });

  it("ー 两列可用两种写法，和词库的おう / おお考点分开", () => {
    for (const spelling of ["koohii", "kouhii", "kōhī", "ko-hii", "koohī"]) {
      expect(matchRomaji("コーヒー", spelling).ok, spelling).toBe(true);
    }
    expect(matchRomaji("こう", "koo")).toMatchObject({ ok: false, readingOk: true, problems: [{ code: "long_vowel", moraIndex: 1 }] });
    expect(matchRomaji("おお", "ou")).toMatchObject({ ok: false, readingOk: true, problems: [{ code: "long_vowel", moraIndex: 1 }] });
    expect(matchRomaji("えい", "ee").problems[0].code).toBe("long_vowel");
    expect(matchRomaji("ええ", "ei").problems[0].code).toBe("long_vowel");
  });

  it("促音、拨音和任意位置分隔符遵守输入边界", () => {
    for (const spelling of ["tchi", "cchi", "xtuchi", "ltuchi", "xtsuchi", "ltsuchi"]) {
      expect(matchRomaji("っち", spelling).ok, spelling).toBe(true);
    }
    expect(matchRomaji("しんあい", "shinnai").ok).toBe(true);
    expect(matchRomaji("しんあい", "shin'ai").ok).toBe(true);
    expect(matchRomaji("しんを", "shin'o").ok).toBe(true);
    expect(matchRomaji("しんあい", "shinai").ok).toBe(false);
    expect(matchRomaji("かんや", "kannya").ok).toBe(true);
    expect(matchRomaji("かんや", "kan'ya").ok).toBe(true);
    expect(matchRomaji("かんや", "kanya").ok).toBe(false);
    expect(matchRomaji("しんぶん", "shimbun").ok).toBe(true);
    expect(matchRomaji("かんと", "kanto").ok).toBe(true);
    expect(matchRomaji("ん", "n").ok).toBe(true);
    expect(matchRomaji("ん", "m").ok).toBe(false);
    expect(matchRomaji("こう", "k o u").ok).toBe(true);
    expect(matchRomaji("コーヒー", "ko-hii").ok).toBe(true);
  });

  it("给错音、长度、长音、促音、拨音分别报位置和类别", () => {
    expect(matchRomaji("さくら", "sakuta")).toMatchObject({ ok: false, problems: [{ code: "wrong_reading", moraIndex: 2 }] });
    expect(matchRomaji("さくら", "saku")).toMatchObject({ ok: false, problems: [{ code: "too_short", moraIndex: 2 }] });
    expect(matchRomaji("さくら", "sakuraka")).toMatchObject({ ok: false, problems: [{ code: "too_long", moraIndex: 3 }] });
    expect(matchRomaji("がっこう", "gakō")).toMatchObject({ ok: false, problems: [{ code: "sokuon", moraIndex: 1 }] });
    expect(matchRomaji("しんぶん", "shibun")).toMatchObject({ ok: false, problems: [{ code: "hatsuon", moraIndex: 1 }] });
    expect(matchRomaji("しんぶん", "shimbunnn")).toMatchObject({ ok: false, problems: [{ code: "hatsuon" }] });
    expect(matchRomaji("さくら", "")).toEqual({ ok: false, readingOk: false, problems: [{ code: "empty" }] });
  });

  it("看答案输出 Hepburn 长音、促音和拨音形式", () => {
    expect(kanaToRomaji("きょう")).toBe("kyou");
    expect(kanaToRomaji("がっこう")).toBe("gakkou");
    expect(kanaToRomaji("しんあい")).toBe("shin'ai");
    expect(kanaToRomaji("ほんやく")).toBe("hon'yaku");
    expect(kanaToRomaji("しんぶん")).toBe("shinbun");
    expect(kanaToRomaji("ラーメン")).toBe("rāmen");
    expect(kanaToRomaji("こんにちは")).toBe("konnichiwa");
    expect(kanaToRomaji("このは")).toBe("konoha");
    expect(matchRomaji("ラーメン", kanaToRomaji("ラーメン")).ok).toBe(true);
  });

  it("粒子词名单精确来自词库末尾读 wa 的词", () => {
    expect([...ROMAJI_PARTICLE_WORDS].sort()).toEqual([
      "あるいは", "こんにちは", "こんばんは", "じつは", "それでは", "ついては", "では",
      "なかには", "ならでは", "ひいては", "または", "もしくは", "ようは"
    ].sort());
    const endingRows = corpus.map((word) => toHiragana(normalizeInput(word.kana).replace(/\s+/gu, "")))
      .filter((kana) => kana.endsWith("は") || kana.endsWith("へ"));
    const endings = new Set(endingRows);
    expect(endingRows).toHaveLength(20);
    expect(endings.size).toBe(18);
    expect([...endings].filter((kana) => !ROMAJI_PARTICLE_WORDS.has(kana)).sort()).toEqual(["このは", "は", "はは", "よは", "りゅうは"]);
    expect([...ROMAJI_PARTICLE_WORDS].every((kana) => endings.has(kana))).toBe(true);
  });
});

describe("词库整库覆盖", () => {
  it("10,919 个 kana 均可切拍回拼，答案和三套独立罗马音都能匹配", () => {
    const skipped: CorpusWord[] = [];
    const failures: string[] = [];
    let covered = 0;
    for (const word of corpus) {
      expect(splitMoras(word.kana).join(""), `${word.id} ${word.kanji}|${word.kana}`).toBe(word.kana);
      const clean = normalizeInput(word.kana).replace(/\s+/gu, "");
      if (!clean || !/^[ぁ-ゖァ-ヺー]+$/u.test(toHiragana(clean))) { skipped.push(word); continue; }
      covered += 1;
      const answers = [kanaToRomaji(word.kana), ...(["hepburn", "nihon", "ime"] as const).map((style) => independentRomaji(word.kana, style))];
      for (const answer of answers) {
        const result = matchRomaji(word.kana, answer);
        if (!result.ok) failures.push(`${word.id} ${word.kanji}|${word.kana} <= ${answer} (${result.problems[0]?.code})`);
      }
    }
    console.info(`词库覆盖 ${covered}/${corpus.length}；跳过 ${skipped.length} 条：${skipped.slice(0, 8).map((word) => `${word.kanji}|${word.kana}`).join("、") || "无"}`);
    expect(failures.slice(0, 20)).toEqual([]);
    expect(skipped.map((word) => `${word.kanji}|${word.kana}`)).toEqual([]);
  });

  it("整库变异仍报对应问题，至少 90% 分类正确", () => {
    const supported = corpus.filter((word) => /^[ぁ-ゖァ-ヺー〜～~・]+$/u.test(word.kana) && normalizeInput(word.kana));
    const plain = supported.filter((word) => {
      const moras = independentMoras(word.kana);
      return moras.length >= 3 && !moras.some((mora) => mora === "っ" || mora === "ん" || mora === "ー") &&
        !moras.some((mora, i) => i > 0 && testLongContinuation(moras[i - 1], mora));
    });
    const stats: string[] = [];
    const assertBatch = (kind: string, rows: CorpusWord[], mutate: (kana: string) => string): void => {
      const batch = rows.slice(0, 120);
      let correct = 0;
      const examples: string[] = [];
      for (const word of batch) {
        const actual = reportFor(word.kana, mutate(word.kana));
        if (actual === kind) correct += 1;
        else if (examples.length < 6) examples.push(`${word.kanji}|${word.kana} → ${mutate(word.kana)} (${actual ?? "accepted"})`);
      }
      stats.push(`${kind} ${correct}/${batch.length}${examples.length ? `; ${examples.join("; ")}` : ""}`);
      expect(correct / batch.length, `${kind}: ${correct}/${batch.length}; ${examples.join("; ")}`).toBeGreaterThanOrEqual(0.9);
    };

    assertBatch("wrong_reading", plain, (kana) => {
      const moras = independentMoras(kana);
      const last = moras.length - 1;
      moras[last] = moras[last] === "た" ? "か" : "た";
      return independentRomaji(moras.join(""), "hepburn");
    });
    assertBatch("too_short", plain, (kana) => independentRomaji(independentMoras(kana).slice(0, -1).join(""), "hepburn"));
    assertBatch("too_long", plain, (kana) => `${independentRomaji(kana, "hepburn")}ka`);

    const sokuon = supported.filter((word) => independentMoras(word.kana).includes("っ"));
    assertBatch("sokuon", sokuon, (kana) => independentRomaji(independentMoras(kana).filter((mora) => mora !== "っ").join(""), "hepburn"));
    const hatsuon = supported.filter((word) => independentMoras(word.kana).includes("ん"));
    assertBatch("hatsuon", hatsuon, (kana) => independentRomaji(independentMoras(kana).filter((mora) => mora !== "ん").join(""), "hepburn"));

    expect(matchRomaji("こう", "koo").problems[0].code).toBe("long_vowel");
    expect(matchRomaji("おお", "ou").problems[0].code).toBe("long_vowel");
    expect(matchRomaji("えい", "ee").problems[0].code).toBe("long_vowel");
    expect(matchRomaji("ええ", "ei").problems[0].code).toBe("long_vowel");
    console.info(`变异分类：${stats.join("；")}；long_vowel 4/4`);
  });
});

describe("长音写错 / 漏写的诊断（促音后、整个漏掉）", () => {
  it("促音后的长音写错、漏写都报 long_vowel", () => {
    expect(matchRomaji("がっこう", "gakkoo").problems).toEqual([{ code: "long_vowel", moraIndex: 3 }]);
    expect(matchRomaji("がっこう", "gakko").problems).toEqual([{ code: "long_vowel", moraIndex: 3 }]);
    expect(matchRomaji("きょう", "kyo").problems).toEqual([{ code: "long_vowel", moraIndex: 1 }]);
    expect(matchRomaji("おおきい", "okii").problems).toEqual([{ code: "long_vowel", moraIndex: 1 }]);
    expect(matchRomaji("せんせい", "sense").problems[0].code).toBe("long_vowel");
  });

  it("多写一个母音仍是 too_long，不当成长音问题", () => {
    expect(matchRomaji("たべる", "taberuu").problems[0].code).toBe("too_long");
  });
});
