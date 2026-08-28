/**
 * 语法卡上的「接续」怎么拆行。
 *
 * `connection` / `structure` 的格式基本是 `前缀＋句型`（「名词の／动词ている＋間」）。
 * 但有 55 条其实是**两条独立的接续规则**用 ／ 连着写的：
 *   ～てください／ないでください → 動詞て形＋ください ／ 動詞ない形＋ないでください
 *   ～うちは／ないうちに        → 动词ない形＋ないうちに ／ 名词の・动词ている＋うちは
 * 这种卡上下各摆一条，一条对一个形式，比挤成一行清楚得多。
 *
 * ⚠️ **不能见 ／ 就拆**：731 条里 405 条带 ／，绝大多数是句型自己的选项
 * （「名詞1＋は＋名詞2＋です／ではありません」），拆开就成了半句话。
 * 判据是 **／ 两边各自都要有 ＋**——有 ＋ 才说明那一段是完整的「什么形＋什么」。
 * 实测这条判据挑出 55 条，逐条看过都是真的两条规则。
 */
export const splitFormationRules = (formation: string | undefined | null): string[] => {
  const text = String(formation ?? "").trim();
  if (!text) return [];
  const index = text.indexOf("／");
  if (index <= 0) return [text];
  const head = text.slice(0, index).trim();
  const tail = text.slice(index + 1).trim();
  if (!head.includes("＋") || !tail.includes("＋")) return [text];
  return [head, tail];
};

/* ------------------------------------------------------------------ *
 * 把接续标到题面 `～` 的头上
 * ------------------------------------------------------------------ */

/**
 * 题面是句型（`～にしろ～にしろ／～にせよ～にせよ`），`～` 是个坑：往里填名词、
 * 动词普通形还是ます形，正是这张卡要考的一半。翻面后光在下面写一行接续，
 * 眼睛还得自己把「名词／用言普通形」和句型里的哪个 `～` 对上号 ——
 * 直接标在那个 `～` 头上（像振假名一样），对号这一步就省了。
 *
 * `formation` 是人写的说明文不是可解析的语法，所以这里的原则是**宁可不标**：
 * 判不准就返回 null，答案区那行完整接续照旧。实测出厂库 741 条里 554 条能标。
 */

const TILDE = /[～〜~]/;
const TILDE_ALL = /[～〜~]/g;
const PLUS = /[＋+]/;

/** 题面按 `～` 切成「填空位 / 字面」两种块，UI 照这个顺序渲染。 */
export interface PatternPiece {
  text: string;
  /** 是不是那个要填东西的 `～` */
  slot: boolean;
}

export const patternPieces = (pattern: string | undefined | null): PatternPiece[] => {
  const pieces: PatternPiece[] = [];
  let buffer = "";
  for (const char of String(pattern ?? "")) {
    if (TILDE.test(char)) {
      if (buffer) pieces.push({ text: buffer, slot: false });
      buffer = "";
      pieces.push({ text: char, slot: true });
    } else {
      buffer += char;
    }
  }
  if (buffer) pieces.push({ text: buffer, slot: false });
  return pieces;
};

/** 题面里 `～` 之间的字面部分（`～にしろ～にせよ` → にしろ / にせよ） */
const patternLiterals = (pattern: string): string[] => String(pattern)
  .split(TILDE_ALL)
  .map((part) => part.replace(/^[／/、，,]+|[／/、，,]+$/g, "").trim())
  .filter(Boolean);

/** 一条接续规则里「＋ 前面那一段」，判不准返回 null */
const attachmentOfRule = (rule: string, pattern: string, slots: number): string | null => {
  if (!PLUS.test(rule)) return null;
  const segments = rule.split(PLUS).map((part) => part.trim()).filter(Boolean);
  const attachment = segments[0] ?? "";
  // 头一段自己还含 `～` 的（`～が／は＋他動詞て形`）说的是助词不是接续
  if (!attachment || TILDE.test(attachment)) return null;

  const literals = patternLiterals(pattern);
  // 和题面字面互相包含 = 它本来就是句型的一部分。`もう～`、`お／ご～になる`、
  // `なにしろ～から` 的头一段是 もう／お／なにしろ，标到 `～` 上就成了「填 お」。
  if (literals.some((literal) => attachment.includes(literal) || literal.includes(attachment))) {
    return null;
  }

  if (slots >= 2) {
    // 多个 `～` 只认**叠用**（`～にしろ～にしろ`：字面两两重复、接续只有一段）。
    // `～から～にかけて`、`～ば～ほど` 两个坑填的不是一个东西，一律不标 ——
    // 把第一个坑的答案抄到第二个头上，比不标更糟。
    if (segments.length > 2 || literals.length !== slots) return null;
    const seen = new Map<string, number>();
    literals.forEach((literal) => seen.set(literal, (seen.get(literal) ?? 0) + 1));
    if (![...seen.values()].every((count) => count >= 2)) return null;
  }
  return attachment;
};

/**
 * 这张卡的 `～` 上该标什么。标不准就返回 null。
 *
 * 两条独立规则写在一起的那 55 条（`動詞て形＋ください／動詞ない形＋ないでください`）
 * 走 splitFormationRules 各取一段再并起来 —— 只取头一段的话，
 * `～てください／ないでください` 会标成「動詞て形」，把另一半说没了。
 */
export const patternAttachment = (
  pattern: string | undefined | null,
  formation: string | undefined | null
): string | null => {
  const text = String(pattern ?? "");
  const slots = (text.match(TILDE_ALL) ?? []).length;
  if (!slots) return null;
  const parts = splitFormationRules(formation)
    .map((rule) => attachmentOfRule(rule, text, slots))
    .filter((part): part is string => Boolean(part));
  if (!parts.length) return null;
  return [...new Set(parts)].join("／");
};
