import { getState, setState, today } from "../study-core";

/**
 * 「上一个」(撤销)的快照栈。
 *
 * 以前是**一条**快照存在 `last_answer` 里,而且没有任何时效/模式校验,于是:
 *   - 撤过一次以后再点,`last_answer` 已经清空 → 兜底去重新抽了一张随机词;
 *   - 换到反向模式点一下 → 把正向刚答的那张拽过来,顺手把 phase 改回 stage1;
 *   - 昨天答完关掉、今天开机就点 → 回滚昨天那次作答的 FSRS 状态,删掉昨天那条流水。
 * 都是「点了没回到上一个」的来源。
 *
 * 现在:一小段栈(最多 UNDO_LIMIT 条),每条自带 `mode` 和 `reviewed_on`,
 * 对不上就当作没得撤销 —— **绝不重新抽词**,由调用方原样返回当前卡并把按钮置灰。
 */

export const UNDO_LIMIT = 2;

/** 沿用旧键名:换了名字等于把用户当前这一场的快照丢掉 */
const STACK_KEY = "last_answer";

export type UndoSnapshot = Record<string, unknown>;

const isSnapshot = (value: unknown): value is UndoSnapshot =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const readUndoStack = (): UndoSnapshot[] => {
  const raw = getState(STACK_KEY, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // 旧格式是单条对象。它没有 mode/reviewed_on,下面的校验会把它判成不可撤销,
    // 正是我们要的:升级那一刻残留的那条快照不该再被翻出来改数据。
    if (isSnapshot(parsed)) return [parsed];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSnapshot);
  } catch {
    return [];
  }
};

const writeUndoStack = (stack: UndoSnapshot[]): void => {
  setState(STACK_KEY, JSON.stringify(stack.slice(-UNDO_LIMIT)));
};

/** 作答后压栈:只留最近 UNDO_LIMIT 条,所以最多连撤两次 */
export const pushUndoSnapshot = (snapshot: UndoSnapshot): void => {
  writeUndoStack([...readUndoStack(), snapshot]);
};

/** 栈顶那条是不是「当下这一场、今天」的 —— 决定按钮亮不亮 */
export const canUndo = (mode: string): boolean => {
  const stack = readUndoStack();
  const top = stack.length ? stack[stack.length - 1] : null;
  return Boolean(top) && top!.mode === mode && top!.reviewed_on === today();
};

/** 取走栈顶(校验不过就不动栈,返回 null) */
export const popUndoSnapshot = (mode: string): UndoSnapshot | null => {
  if (!canUndo(mode)) return null;
  const stack = readUndoStack();
  const top = stack.pop()!;
  writeUndoStack(stack);
  return top;
};

/**
 * 撤销后钉住那张卡:之后任何一次取卡(刷新、切前后台、读一次 session)都得把它交回来,
 * 而不是重新抽一张 —— 否则「回到上一个」只活在这一次返回值里。作答时消费掉。
 */
const PIN_KEY = "undo_pinned_card";

export const pinCard = (wordId: number, mode: string): void => {
  setState(PIN_KEY, JSON.stringify({ word_id: wordId, mode }));
};

export const readPinnedCard = (mode: string): number | null => {
  const raw = getState(PIN_KEY, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isSnapshot(parsed) || parsed.mode !== mode) return null;
    const wordId = Number(parsed.word_id);
    return Number.isFinite(wordId) && wordId > 0 ? wordId : null;
  } catch {
    return null;
  }
};

export const clearPinnedCard = (): void => {
  setState(PIN_KEY, "");
};
