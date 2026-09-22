#!/usr/bin/env node
/**
 * 五十音卡片校验脚本 —— docs/KANA_CARDS_SPEC.md 第 7 节
 *
 * 用法：node frontend/scripts/verify-kana-cards.mjs
 * 零参数。全部通过时打印一行 `kana cards ok: 250 cards` 并 exit 0；
 * 任何一条不过则 exit 1，逐条打印「哪张卡、哪个字段、为什么」。
 *
 * 只依赖 node:fs / node:path，不引入新依赖；词表读 docs/kana-cards-n5-words.tsv，不读数据库。
 *
 * 例词白名单说明：
 * - gairai 组：词表里没有 ファ／ティ 这些音的词，按规格 3.4 放行下面这份白名单。
 * - rule-particles / rule-pitch：按规格 3.7 放行（助词卡是短语、声调卡是同一个词的两个意思）。
 *
 * 例词选取规则（卡片侧）：优先取含本假名的词；该假名在词表里凑不满 3 个时，
 * 用同一行／同音的词补齐（片假名卡用对应平假名卡的例词，外来语专用音用白名单）。
 * 例如 ぺ／ぴゃ 在 892 词里没有对应的词，只能用 ぱ 行的 いっぱい・えんぴつ・さんぽ 顶上。
 *
 * 例词比对的是词表的「假名」列（本文件第 1 列），同时也接受第 2 列：
 * 词表第 2 列是表记（有汉字时写汉字，没汉字时才写假名），例词统一用假名写，
 * 所以两列都收进白名单，避免把 あさ（朝）这种正确例词判成表外词。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = {
  cards: path.join(ROOT, 'frontend/src/data/kana_cards.json'),
  confusables: path.join(ROOT, 'frontend/src/data/kana_confusables.json'),
  glossary: path.join(ROOT, 'frontend/src/data/kana_glossary.json'),
  words: path.join(ROOT, 'docs/kana-cards-n5-words.tsv'),
};

const GROUP_COUNTS = { seion: 92, dakuon: 50, youon: 66, gairai: 10, rule: 12, phrase: 20 };
const TOTAL = 250;
const NOTE_MAX = 60;
const BODY_MAX = 60;
const EXAMPLE_COUNT = { kana: 3, rule: 4, phrase: 0 };
const KANA_ONE = /^[\u3041-\u3096\u30a1-\u30fa]{1,2}$/;
const ID_RE = /^(hira|kata|gairai|rule|phrase)-[a-z]+(-[a-z]+)*$/;

// 规格 3.4：外来语专用音的例词白名单
const GAIRAI_WHITELIST = [
  'ソファー', 'ファクス', 'オフィス', 'サーフィン', 'カフェ', 'フェリー', 'フォーク', 'フォーム',
  'パーティー', 'スパゲッティ', 'シーディー', 'メディア', 'ゴールデンウィーク', 'ウィンドー',
  'シェア', 'シェフ', 'プロジェクト', 'チェック', 'チェックイン',
];
// 规格 3.7：这两张卡的例词允许不在词表里
const OFF_LIST_OK = new Set(['rule-particles', 'rule-pitch']);
const GAIRAI_SET = new Set(GAIRAI_WHITELIST);

// 规格 3.5 字源表（平假名 + 片假名两栏合起来）
const ORIGINS = new Set(
  ('安以宇衣於加幾久計己左之寸世曽太知川天止奈仁奴祢乃波比不部保末美武女毛也由与良利留礼呂和遠无' +
    '阿伊宇江於加幾久介己散之須世曽多千川天止奈二奴祢乃八比不部保末三牟女毛也由與良利流礼呂和乎尓').split('')
);

// 规格 3.1 / 3.2 / 3.3 / 3.4 的清单（用来核对「有没有漏卡、有没有多卡」）
const HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const DAKU = 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ';
const YOUON = [
  'きゃ', 'きゅ', 'きょ', 'しゃ', 'しゅ', 'しょ', 'ちゃ', 'ちゅ', 'ちょ', 'にゃ', 'にゅ', 'にょ',
  'ひゃ', 'ひゅ', 'ひょ', 'みゃ', 'みゅ', 'みょ', 'りゃ', 'りゅ', 'りょ', 'ぎゃ', 'ぎゅ', 'ぎょ',
  'じゃ', 'じゅ', 'じょ', 'びゃ', 'びゅ', 'びょ', 'ぴゃ', 'ぴゅ', 'ぴょ',
];
const GAIRAI = ['ファ', 'フィ', 'フェ', 'フォ', 'ティ', 'ディ', 'ウィ', 'シェ', 'ジェ', 'チェ'];

// 规格 5：必须覆盖的术语清单
const REQUIRED_TERMS = [
  '平假名', '片假名', '五十音', '清音', '浊音', '半浊音', '拗音', '外来语', '外来语专用音',
  '拍', '一拍', '长音', '长音符', '促音', '拨音', '小写假名',
  '送气', '不送气', '声带振动', '卷舌', '双唇音', '闪音', '鼻音', '圆唇',
  '声调', '平板型', '头高型', '中高型', '尾高型',
  '字源', '草书', '万叶假名', '偏旁', '送假名', '罗马字',
];

const toKata = (s) => [...s].map((c) => {
  const n = c.codePointAt(0);
  return n >= 0x3041 && n <= 0x3096 ? String.fromCodePoint(n + 0x60) : c;
}).join('');
const len = (s) => [...String(s ?? '')].length;

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`[文件] ${path.relative(ROOT, file)}: 读不到或不是合法 JSON —— ${e.message}`);
    return null;
  }
}

function readWordList(errors) {
  try {
    const set = new Set();
    const text = fs.readFileSync(F.words, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.replace(/\r$/, '').split('\t');
      if (cols[0]) set.add(cols[0].trim());
      if (cols[1]) set.add(cols[1].trim());
    }
    return set;
  } catch (e) {
    errors.push(`[文件] docs/kana-cards-n5-words.tsv: 读不到 —— ${e.message}`);
    return new Set();
  }
}

function validate(data) {
  const errors = [];
  const { cards, confusables, glossary, words } = data;
  if (!Array.isArray(cards) || !Array.isArray(confusables) || !Array.isArray(glossary)) {
    return ['[文件] 三个 JSON 里 cards / pairs / terms 必须是数组'];
  }

  // 1. 三个 JSON 能解析、version 都是 1（解析已在读取时完成，这里查 version）
  for (const [name, obj] of data.versions) {
    if (obj === null) continue;
    if (obj.version !== 1) errors.push(`[文件] ${name}: version 必须是 1，现在是 ${JSON.stringify(obj.version)}`);
  }

  // 2. 卡片数
  const byGroup = {};
  for (const c of cards) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  for (const [g, n] of Object.entries(GROUP_COUNTS)) {
    if ((byGroup[g] || 0) !== n) {
      errors.push(`[分组] ${g}: 应有 ${n} 张，实际 ${byGroup[g] || 0} 张`);
    }
  }
  for (const g of Object.keys(byGroup)) {
    if (!(g in GROUP_COUNTS)) errors.push(`[分组] ${g}: 不是规格里的分组名`);
  }
  if (cards.length !== TOTAL) errors.push(`[总数] 应有 ${TOTAL} 张，实际 ${cards.length} 张`);

  // 3. id 全局唯一 + 命名规则
  const seen = new Set();
  for (const c of cards) {
    const id = c.id;
    if (typeof id !== 'string' || !id) { errors.push(`[${c.front ?? '?'}] id: 缺失`); continue; }
    if (seen.has(id)) errors.push(`[${id}] id: 和前面的卡重复`);
    seen.add(id);
    if (!ID_RE.test(id)) errors.push(`[${id}] id: 不符合命名规则（hira- / kata- / gairai- / rule- / phrase- 加小写英文）`);
  }
  const byId = new Map(cards.map((c) => [c.id, c]));

  // 4. kana 卡逐字段
  for (const c of cards) {
    if (c.kind !== 'kana') continue;
    const tag = `[${c.id}]`;
    if (!KANA_ONE.test(c.front ?? '')) errors.push(`${tag} front: 「${c.front}」不是一到两个假名字符`);
    const isHira = /^[\u3041-\u3096]+$/.test(c.front ?? '');
    const isKata = /^[\u30a1-\u30fa]+$/.test(c.front ?? '');
    if (!isHira && !isKata) errors.push(`${tag} front: 「${c.front}」既不是平假名也不是片假名`);
    if (c.group === 'gairai') {
      // 外来语专用音只有片假名，用 gairai- 前缀，避免和 ヂ（di）这类 id 撞车
      if (!c.id.startsWith('gairai-')) errors.push(`${tag} id: 外来语专用音卡的 id 应该以 gairai- 开头`);
    } else if (isHira && !c.id.startsWith('hira-')) {
      errors.push(`${tag} id: 平假名卡的 id 应该以 hira- 开头`);
    } else if (isKata && !c.id.startsWith('kata-')) {
      errors.push(`${tag} id: 片假名卡的 id 应该以 kata- 开头`);
    }

    if (!c.romaji || !/^[a-z]+$/.test(c.romaji)) {
      errors.push(`${tag} romaji: 「${c.romaji}」必须是非空的全小写字母`);
    }

    if (c.group === 'gairai') {
      if (c.pair !== '') errors.push(`${tag} pair: 外来语专用音没有平假名对应，应填空字符串`);
      if (c.origin !== '') errors.push(`${tag} origin: 外来语专用音没有字源，应填空字符串`);
    } else {
      if (!KANA_ONE.test(c.pair ?? '')) errors.push(`${tag} pair: 「${c.pair}」不是一到两个假名字符`);
      if (!ORIGINS.has(c.origin)) errors.push(`${tag} origin: 「${c.origin}」不在规格 3.5 的字源表里`);
      const twin = byId.get((isHira ? 'kata-' : 'hira-') + c.id.replace(/^(hira|kata)-/, ''));
      if (!twin) {
        errors.push(`${tag} pair: 找不到配对卡 ${(isHira ? 'kata-' : 'hira-') + c.id.replace(/^(hira|kata)-/, '')}`);
      } else {
        if (twin.front !== c.pair) errors.push(`${tag} pair: 写的是「${c.pair}」，但 ${twin.id} 的 front 是「${twin.front}」`);
        if (twin.pair !== c.front) errors.push(`${tag} pair: ${twin.id} 的 pair 是「${twin.pair}」，对不上本卡的「${c.front}」`);
      }
    }
  }

  // 分组清单核对：多卡漏卡都算错
  const expect = {
    seion: [...HIRA, ...KATA],
    dakuon: [...DAKU, ...toKata(DAKU)],
    youon: [...YOUON, ...YOUON.map(toKata)],
    gairai: [...GAIRAI],
  };
  for (const [g, list] of Object.entries(expect)) {
    const got = new Set(cards.filter((c) => c.group === g).map((c) => c.front));
    for (const k of list) if (!got.has(k)) errors.push(`[分组 ${g}] 缺少「${k}」这张卡`);
    for (const k of got) if (!list.includes(k)) errors.push(`[分组 ${g}] 多出「${k}」这张卡，规格里没有`);
  }

  // 5. note ≤ 60 字；6. 例词数量与来源
  for (const c of cards) {
    const tag = `[${c.id}]`;
    if (typeof c.note !== 'string' || !c.note.trim()) {
      errors.push(`${tag} note: 不能为空`);
    } else if (len(c.note) > NOTE_MAX) {
      errors.push(`${tag} note: ${len(c.note)} 字，超过 ${NOTE_MAX} 字`);
    }

    if (!Array.isArray(c.examples)) {
      errors.push(`${tag} examples: 必须是数组`);
      continue;
    }
    const want = EXAMPLE_COUNT[c.kind];
    if (c.examples.length !== want) {
      errors.push(`${tag} examples: ${c.kind} 卡应有 ${want} 个例词，实际 ${c.examples.length} 个`);
    }
    for (const ex of c.examples) {
      if (!Array.isArray(ex) || ex.length !== 2 || typeof ex[0] !== 'string' || typeof ex[1] !== 'string' || !ex[1].trim()) {
        errors.push(`${tag} examples: 「${JSON.stringify(ex)}」必须是 [假名, 中文] 两个字符串`);
        continue;
      }
      if (OFF_LIST_OK.has(c.id)) continue;
      const allowed = c.group === 'gairai' ? GAIRAI_SET : words;
      if (!allowed.has(ex[0])) {
        errors.push(`${tag} examples: 例词「${ex[0]}」不在 docs/kana-cards-n5-words.tsv 里`);
      }
    }
  }

  // 7. rule 卡 quiz
  for (const c of cards) {
    if (c.kind !== 'rule') continue;
    const tag = `[${c.id}]`;
    if (!Array.isArray(c.quiz)) { errors.push(`${tag} quiz: 必须是数组`); continue; }
    if (c.id === 'rule-pitch') {
      if (c.quiz.length !== 0) errors.push(`${tag} quiz: 声调卡只说明规则，应填空数组`);
      continue;
    }
    if (c.quiz.length < 3) errors.push(`${tag} quiz: 至少要 3 组，现在 ${c.quiz.length} 组`);
    for (const q of c.quiz) {
      if (!Array.isArray(q) || q.length !== 2) { errors.push(`${tag} quiz: 「${JSON.stringify(q)}」必须是 [正确, 错误] 两组`); continue; }
      const [right, wrong] = q;
      if (right === wrong) errors.push(`${tag} quiz: 「${right}」正确项和错误项一样`);
      if (!words.has(right)) errors.push(`${tag} quiz: 正确项「${right}」不在词表里`);
      if (words.has(wrong)) errors.push(`${tag} quiz: 错误项「${wrong}」本身是词表里的词，起不到干扰作用`);
    }
  }

  // 8. 形近表
  const used = new Map();
  confusables.forEach((group, i) => {
    if (!Array.isArray(group) || group.length < 2 || group.length > 3) {
      errors.push(`[形近表 第 ${i + 1} 组] 一组必须是 2〜3 个假名，现在是 ${JSON.stringify(group)}`);
      return;
    }
    for (const k of group) {
      if (typeof k !== 'string' || len(k) !== 1 || !/[\u3041-\u3096\u30a1-\u30fa]/.test(k)) {
        errors.push(`[形近表 第 ${i + 1} 组] 「${k}」必须是单个假名字符`);
        continue;
      }
      if (used.has(k)) errors.push(`[形近表] 「${k}」同时出现在第 ${used.get(k)} 组和第 ${i + 1} 组`);
      else used.set(k, i + 1);
    }
  });

  // 9. 术语表
  const labels = new Set();
  const cardText = cards.map((c) => [c.note, ...(c.scenes || []), ...((c.quiz || []).flat())].join('\n')).join('\n');
  for (const t of glossary) {
    const tag = `[术语 ${t.label ?? '?'}]`;
    if (!t.label) { errors.push(`${tag} label: 不能为空`); continue; }
    if (labels.has(t.label)) errors.push(`${tag} label: 和前面的条目重复`);
    labels.add(t.label);
    if (!t.title) errors.push(`${tag} title: 不能为空`);
    if (typeof t.body !== 'string' || !t.body.trim()) errors.push(`${tag} body: 不能为空`);
    else if (len(t.body) > BODY_MAX) errors.push(`${tag} body: ${len(t.body)} 字，超过 ${BODY_MAX} 字`);
    if (!Array.isArray(t.examples) || t.examples.length < 2 || t.examples.length > 3) {
      errors.push(`${tag} examples: 应有 2〜3 个，实际 ${Array.isArray(t.examples) ? t.examples.length : '不是数组'}`);
    }
    if (!cardText.includes(t.label)) errors.push(`${tag} label: 在卡片正文（note / quiz / scenes）里一次都没出现`);
  }

  // 10. 反查：术语清单里的词在正文里露头了，术语表就必须有
  for (const term of REQUIRED_TERMS) {
    if (!labels.has(term)) errors.push(`[术语表] 规格 5 要求的术语「${term}」没有条目`);
    else if (cardText.includes(term) && !labels.has(term)) errors.push(`[术语表] 「${term}」出现在卡片里，却没有条目`);
  }

  return errors;
}

function load() {
  const errors = [];
  const cardsJson = readJson(F.cards, errors);
  const confJson = readJson(F.confusables, errors);
  const glossJson = readJson(F.glossary, errors);
  const words = readWordList(errors);
  if (errors.length) {
    errors.forEach((e) => console.error(e));
    console.error('校验不通过：1 个错误');
    process.exit(1);
  }
  return {
    cards: cardsJson.cards,
    confusables: confJson.pairs,
    glossary: glossJson.terms,
    words,
    versions: [
      ['frontend/src/data/kana_cards.json', cardsJson],
      ['frontend/src/data/kana_confusables.json', confJson],
      ['frontend/src/data/kana_glossary.json', glossJson],
    ],
  };
}

function main() {
  const data = load();
  const errors = validate(data);
  if (errors.length) {
    errors.forEach((e) => console.error(e));
    console.error(`校验不通过：${errors.length} 个错误`);
    process.exit(1);
  }

  // 脚本自检：用内联的坏数据跑一遍校验函数，断言它返回了错误
  const clone = () => ({
    ...JSON.parse(JSON.stringify({ cards: data.cards, confusables: data.confusables, glossary: data.glossary })),
    words: new Set(data.words),
    versions: data.versions,
  });
  const fixtures = [];
  const a = clone();
  a.cards.pop();
  fixtures.push(['少一张卡', a]);
  const b = clone();
  b.cards.find((c) => c.kind === 'kana').examples[0][0] = 'ぬぬぬ';
  fixtures.push(['一个不存在的例词', b]);
  const c = clone();
  c.cards.find((x) => x.kind === 'kana').note = 'あ'.repeat(NOTE_MAX + 1);
  fixtures.push(['note 超过 60 字', c]);
  const d = clone();
  d.confusables = [['あ', 'お'], ['あ', 'ぬ']];
  fixtures.push(['形近表里同一个假名出现两次', d]);

  const missed = fixtures.filter(([, bad]) => validate(bad).length === 0).map(([name]) => name);
  if (missed.length) {
    missed.forEach((name) => console.error(`[自检] 坏数据没有被发现：${name}`));
    console.error('校验不通过：自检失败');
    process.exit(1);
  }

  console.log(`kana cards ok: ${data.cards.length} cards`);
}

main();
