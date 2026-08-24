import { getDatabase } from "./database";
import { ensureGrammarProgressInitialized } from "./grammar-api";
import { firstValue, rowsFor, today } from "./study-core";

/**
 * 语法考题：题面是日语句型，答案是它的接续 + 中文意。
 *
 * **刻意不上 FSRS。** 一个等级只有一百来条（N5 120 / N4 130 / N3 140 / N2 148 / N1 193），
 * 间隔重复算法在这个规模上没有实际意义 —— 一轮就能全过一遍。所以这里只做两件事：
 *   1. 本轮**乱序、不重复**：开轮时把该等级洗一遍牌，一张一张过完为止；
 *   2. 累计**答错次数**，让外面的列表能按它排序，把总错的那些顶到前面。
 *
 * 数据全部落在 `grammar_progress`（数字 grammar_id，和 grammar_points 同一套 id）：
 * 题面/接续/释义三样都是 grammar_points 的列，不需要跨 id 体系搭桥。
 *
 * ⚠️ 这和语法**列表页**的「熟悉/没记住」不是同一份数据：那一套在
 * `hooks/useStudyStore` 的 localStorage 里，按 grammar.ts 的字符串 id 存，而且不同步。
 * 这里用 grammar_progress 是因为它已经接了云同步、也已经有 forgot_count/right_count
 * 这几列（建了很久一直没人写）。两份要不要合并是另一件事，别顺手混用。
 */
export type GrammarQuizAnswer = "forgot" | "know" | "known_forever";

export interface GrammarQuizCard {
  id: number;
  /** 题面：句型本身 */
  pattern: string;
  /** 答案上半：接续 */
  formation: string;
  /** 答案下半：中文意 */
  meaning: string;
  level: string;
  forgotCount: number;
  rightCount: number;
}

export interface GrammarQuizSession {
  card: GrammarQuizCard | null;
  level: string;
  /** 第几轮（洗过几次牌） */
  seq: number;
  /** 本轮已答几张 */
  done: number;
  /** 本轮总共几张 */
  total: number;
}

interface RoundState {
  seq: number;
  /** 开轮时洗好的顺序，全程不变 —— 「乱序不重复」就是照它走一遍 */
  order: number[];
  /** 走到第几张 */
  index: number;
}

const roundKey = (level: string) => `quiz_round:${level}`;

const readRound = (level: string): RoundState | null => {
  try {
    const raw = firstValue<string>("SELECT value FROM grammar_state WHERE key = ?", [roundKey(level)], "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const order = Array.isArray(parsed?.order) ? parsed.order.map(Number).filter(Number.isFinite) : [];
    if (!order.length) return null;
    return { seq: Number(parsed?.seq ?? 1) || 1, order, index: Math.max(Number(parsed?.index ?? 0) || 0, 0) };
  } catch {
    return null;
  }
};

const writeRound = (level: string, round: RoundState) => {
  getDatabase().run(
    "INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",
    [roundKey(level), JSON.stringify(round)]
  );
};

/** Fisher–Yates。抽出来是为了测试能注入一个确定的随机源。 */
export const shuffle = <T,>(items: readonly T[], random: () => number = Math.random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** 这个等级里还该考的句型 id（标了熟知的退出，不再出现） */
const quizPoolIds = (level: string): number[] => {
  ensureGrammarProgressInitialized();
  return rowsFor(`
    SELECT g.id
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ? AND COALESCE(p.known_forever, 0) = 0
    ORDER BY g.sort_order
  `, [level]).map((row) => Number(row.id));
};

const cardById = (id: number): GrammarQuizCard | null => {
  const row = rowsFor(`
    SELECT g.id, g.pattern, g.formation, g.meaning, g.level,
      COALESCE(p.forgot_count, 0) AS forgot_count,
      COALESCE(p.right_count, 0) AS right_count,
      COALESCE(p.known_forever, 0) AS known_forever
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id = ?
  `, [id])[0];
  if (!row || Number(row.known_forever ?? 0) === 1) return null;
  return {
    id: Number(row.id),
    pattern: String(row.pattern ?? ""),
    formation: String(row.formation ?? ""),
    meaning: String(row.meaning ?? ""),
    level: String(row.level ?? ""),
    forgotCount: Number(row.forgot_count ?? 0),
    rightCount: Number(row.right_count ?? 0)
  };
};

const sessionFrom = (level: string, round: RoundState): GrammarQuizSession => {
  // 中途被标熟知、或者换种子库之后没了的 id 直接跳过，不让它卡住一轮。
  let index = round.index;
  let card: GrammarQuizCard | null = null;
  while (index < round.order.length) {
    const candidate = cardById(round.order[index]);
    if (candidate) { card = candidate; break; }
    index += 1;
  }
  if (index !== round.index) writeRound(level, { ...round, index });
  return { card, level, seq: round.seq, done: index, total: round.order.length };
};

/** 开新一轮：重新洗牌。轮次号累加，方便界面说「第 3 轮」。 */
export const startGrammarQuizRound = (level: string, random?: () => number): GrammarQuizSession => {
  const previous = readRound(level);
  const round: RoundState = {
    seq: (previous?.seq ?? 0) + 1,
    order: shuffle(quizPoolIds(level), random),
    index: 0
  };
  writeRound(level, round);
  void import("./storage").then(({ scheduleSave }) => scheduleSave());
  return sessionFrom(level, round);
};

/** 取当前这一张。没开过轮就自动开一轮；走完了就返回 card=null，由界面问要不要再来一轮。 */
export const getGrammarQuizSession = (level: string, random?: () => number): GrammarQuizSession => {
  const round = readRound(level);
  if (!round) return startGrammarQuizRound(level, random);
  return sessionFrom(level, round);
};

/**
 * 记一次作答，然后往后走一张。
 *
 * 没记住只累加 forgot_count，**不把这张塞回本轮** —— 一轮之内不重复是这个模式的定义，
 * 错的那些靠外面按答错次数排序去回头看。
 */
export const submitGrammarQuizAnswer = (
  level: string,
  grammarId: number,
  answer: GrammarQuizAnswer
): GrammarQuizSession => {
  ensureGrammarProgressInitialized();
  const db = getDatabase();
  const day = today();
  if (answer === "forgot") {
    db.run(`
      UPDATE grammar_progress
      SET seen_count = seen_count + 1, forgot_count = forgot_count + 1,
          mistake_streak = mistake_streak + 1, last_seen_on = ?
      WHERE grammar_id = ?
    `, [day, grammarId]);
  } else {
    db.run(`
      UPDATE grammar_progress
      SET seen_count = seen_count + 1, right_count = right_count + 1,
          mistake_streak = 0, last_seen_on = ?, known_forever = ?
      WHERE grammar_id = ?
    `, [day, answer === "known_forever" ? 1 : 0, grammarId]);
  }

  const round = readRound(level);
  if (round) writeRound(level, { ...round, index: round.index + 1 });
  void import("./storage").then(({ scheduleSave }) => scheduleSave());
  return getGrammarQuizSession(level);
};

export interface GrammarQuizRankRow extends GrammarQuizCard {
  seenCount: number;
  knownForever: boolean;
}

/**
 * 「外部按答错次数排序」的那份列表：错得最多的排最前，没答过的排最后。
 * 这就是这个模式里唯一的「算法」。
 */
export const grammarQuizRanking = (level: string): GrammarQuizRankRow[] => {
  ensureGrammarProgressInitialized();
  return rowsFor(`
    SELECT g.id, g.pattern, g.formation, g.meaning, g.level,
      COALESCE(p.forgot_count, 0) AS forgot_count,
      COALESCE(p.right_count, 0) AS right_count,
      COALESCE(p.seen_count, 0) AS seen_count,
      COALESCE(p.known_forever, 0) AS known_forever
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ?
    ORDER BY COALESCE(p.forgot_count, 0) DESC,
             COALESCE(p.seen_count, 0) ASC,
             g.sort_order ASC
  `, [level]).map((row) => ({
    id: Number(row.id),
    pattern: String(row.pattern ?? ""),
    formation: String(row.formation ?? ""),
    meaning: String(row.meaning ?? ""),
    level: String(row.level ?? ""),
    forgotCount: Number(row.forgot_count ?? 0),
    rightCount: Number(row.right_count ?? 0),
    seenCount: Number(row.seen_count ?? 0),
    knownForever: Number(row.known_forever ?? 0) === 1
  }));
};
