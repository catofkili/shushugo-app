/**
 * 学习时长的跨设备口径。
 *
 * word_study_time 按 studied_on 单主键记录每天学习秒数。两端同一天各学一段时,
 * 逐行 LWW 会丢掉一端、求和又会在重复同步时越加越多,所以它不参与同步。
 * 真正同步的是 word_study_time_by_device(studied_on, device_id):各设备只写
 * 自己那行,读的时候按天求和写回 word_study_time —— 这样统计页、复习预算等
 * 一堆读取方不用改,拿到的就是跨设备汇总。
 */

import { getDatabase } from "../database";
import { rowsFor } from "../database/db-utils";
import { getDeviceId } from "./schema";
import { STUDY_TIME_TABLE } from "./tables";

const aggregateDay = (day: string): void => {
  getDatabase().run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    SELECT ?, COALESCE(SUM(seconds), 0), CURRENT_TIMESTAMP
    FROM ${STUDY_TIME_TABLE}
    WHERE studied_on = ?
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `, [day, day]);
};

/** 记一段学习时长:写进本设备那行,再把当天的跨设备合计写回 word_study_time。 */
export function recordStudySeconds(day: string, seconds: number): void {
  const amount = Math.max(0, Math.round(seconds));
  if (!amount) return;
  getDatabase().run(`
    INSERT INTO ${STUDY_TIME_TABLE} (studied_on, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(studied_on, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `, [day, getDeviceId(), amount]);
  aggregateDay(day);
}

/**
 * 把 by_device 的每日合计整体写回 word_study_time。合并完云端数据后调用,
 * 否则对端学习的时长虽然同步下来了,统计页仍然只看得到本机那份。
 */
export function rebuildStudyTimeAggregate(): void {
  const db = getDatabase();
  db.run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    SELECT studied_on, SUM(seconds), CURRENT_TIMESTAMP
    FROM ${STUDY_TIME_TABLE}
    GROUP BY studied_on
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `);
}

/**
 * 存量历史迁移:by_device 表是后加的,它之前的学习时长只存在 word_study_time 里。
 * 把这些天补一行记在本设备名下,否则第一次 rebuild 就会把历史清零。
 *
 * 判据用数据本身而不是 app_state 标记——app_state 参与同步,标记会被对端带过来,
 * 那样第二台设备会以为自己已经迁移过,直接丢掉本机历史。
 */
export function backfillStudyTimeByDevice(): void {
  const pending = rowsFor(`
    SELECT t.studied_on, t.seconds
    FROM word_study_time t
    WHERE t.seconds > 0
      AND NOT EXISTS (
        SELECT 1 FROM ${STUDY_TIME_TABLE} d WHERE d.studied_on = t.studied_on
      )
  `);
  if (!pending.length) return;

  const db = getDatabase();
  const deviceId = getDeviceId();
  db.run("BEGIN");
  try {
    for (const row of pending) {
      db.run(
        `INSERT OR REPLACE INTO ${STUDY_TIME_TABLE} (studied_on, device_id, seconds) VALUES (?, ?, ?)`,
        [String(row.studied_on), deviceId, Number(row.seconds ?? 0)]
      );
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}
