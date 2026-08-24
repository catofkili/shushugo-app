import { getDatabase } from "../database";
import { rowsFor } from "../database/db-utils";

/**
 * 用户自己改写的题面首义。
 *
 * 存在的理由：正向题里 35.6% 的词和别的词共用同一行题面（口径见
 * question-meaning-index）。拍数提示能拆开其中一半，剩下的 1,967 个词
 * 靠任何算法都分不出来 —— 「相当」底下的 かなり/なかなか/よほど/相当/随分
 * 哪个才是这张卡，只有用户自己知道该按什么区别去记。
 *
 * 所以这一层是**手动的**：撞上了才改，改的是他自己那份库。
 *
 * 几条口径：
 *  - **写自己的表，不写 words.meaning。** words 表不同步，而且词单导入/换种子库
 *    会整表覆盖 —— 手改的内容会静默一次性没掉。
 *  - **跳过 promptMeaning 的全部清洗**（首义切分、8 字截断、括号剥离…）。
 *    用户写的就是最终形态，截断会把「相当（书面·程度高）」砍成「相当（书面」。
 *  - **只覆盖题面那一行，不动完整释义。** 答案面仍然显示 words.meaning 原文，
 *    这样他随时看得见自己改掉了什么。
 *  - 缺表返回空（老库、测试里的裸库都可能没有这张表），不抛错。
 */

let cached: Map<number, string> | null = null;

export const resetUserQuestionMeanings = (): void => {
  cached = null;
};

const index = (): Map<number, string> => {
  if (cached) return cached;
  const map = new Map<number, string>();
  try {
    rowsFor("SELECT word_id, prompt_meaning FROM word_question_meanings").forEach((row) => {
      const id = Number(row.word_id ?? 0);
      const text = String(row.prompt_meaning ?? "").trim();
      if (id && text) map.set(id, text);
    });
  } catch {
    // 老库没有这张表 —— 等同于一条覆盖都没有。
  }
  cached = map;
  return map;
};

/** 这个词的用户题面。没改过返回 undefined。 */
export const userQuestionMeaning = (wordId: number): string | undefined => index().get(wordId);

/** 改过题面的词数（设置页/词库页用来显示「你改过 N 条」）。 */
export const userQuestionMeaningCount = (): number => index().size;

/**
 * 写入或清除一个词的题面。传空串 = 恢复原文（删行，靠同步触发器留墓碑，
 * 否则另一台设备会把删掉的覆盖再复活）。
 *
 * **不在这里触发云同步**：编辑发生在学习页，一场里改五个题面就是五次全库
 * 快照上传。和便签一样只落本地盘，攒到正常同步节奏一起走。
 */
export const saveUserQuestionMeaning = (wordId: number, text: string): string => {
  const db = getDatabase();
  const cleaned = text.trim();
  if (cleaned) {
    db.run(
      `INSERT INTO word_question_meanings (word_id, prompt_meaning, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(word_id) DO UPDATE SET
         prompt_meaning = excluded.prompt_meaning,
         updated_at = excluded.updated_at`,
      [wordId, cleaned]
    );
  } else {
    db.run("DELETE FROM word_question_meanings WHERE word_id = ?", [wordId]);
  }
  cached = null;
  return cleaned;
};
