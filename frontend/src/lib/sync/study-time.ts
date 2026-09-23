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

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** 把一个时间点归入最近的周日 14:00 周期。 */
export const reportPeriodStart = (atMs: number): string => {
  const date = new Date(atMs);
  date.setHours(14, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  if (atMs < date.getTime()) date.setDate(date.getDate() - 7);
  return `${localDateKey(date)} 14:00`;
};

/** 新版周报时长账本：每台设备每个 14:00 周期一行，跨设备读取时求和。 */
const addPeriodSeconds = (period: string, seconds: number): void => {
  if (seconds <= 0) return;
  getDatabase().run(`
    INSERT INTO study_time_by_period (period_start, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(period_start, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `, [period, getDeviceId(), seconds]);
};

export function recordReportStudySeconds(atMs: number, seconds: number): void {
  const amount = Math.max(0, Math.round(seconds));
  if (!amount) return;
  const hasTable = rowsFor(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_time_by_period' LIMIT 1"
  ).length > 0;
  if (!hasTable) return;
  // The duration is treated as the contiguous interval ending at the
  // settlement time. Split it at each Sunday 14:00 boundary instead of
  // assigning the whole flush to whichever period contains its end.
  let cursor = atMs - amount * 1000;
  const end = atMs;
  let remaining = amount;
  while (cursor < end) {
    const period = reportPeriodStart(cursor);
    const boundary = new Date(`${period.replace(" ", "T")}:00`);
    boundary.setDate(boundary.getDate() + 7);
    const chunkEnd = Math.min(end, boundary.getTime());
    // Millisecond-level settlement times can put half a second on each side of
    // the boundary. Round intermediate chunks, then give the final chunk the
    // remainder so splitting can never create or lose a second.
    const chunkSeconds = chunkEnd === end
      ? remaining
      : Math.min(remaining, Math.max(0, Math.round((chunkEnd - cursor) / 1000)));
    addPeriodSeconds(period, chunkSeconds);
    remaining -= chunkSeconds;
    cursor = chunkEnd;
    if (chunkSeconds === 0) cursor += 1000;
  }
}

/** 记一段学习时长：保留旧的日汇总，同时写入周报 14:00 周期账本。 */
export function recordStudySeconds(day: string, seconds: number, atMs = Date.now()): void {
  const amount = Math.max(0, Math.round(seconds));
  if (!amount) return;
  getDatabase().run(`
    INSERT INTO ${STUDY_TIME_TABLE} (studied_on, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(studied_on, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `, [day, getDeviceId(), amount]);
  aggregateDay(day);
  recordReportStudySeconds(atMs, amount);
}

/**
 * 把 by_device 的每日合计整体写回 word_study_time。合并完云端数据后调用,
 * 否则对端学习的时长虽然同步下来了,统计页仍然只看得到本机那份。
 */
export function rebuildStudyTimeAggregate(): void {
  const db = getDatabase();
  // 启动恢复和云端事务都会调用；savepoint 允许嵌套且避免重建只执行一半。
  db.run("SAVEPOINT rebuild_study_time");
  try {
    db.run(`DELETE FROM word_study_time WHERE NOT EXISTS (
      SELECT 1 FROM ${STUDY_TIME_TABLE} d WHERE d.studied_on = word_study_time.studied_on
    )`);
    db.run(`
      INSERT INTO word_study_time (studied_on, seconds, updated_at)
      SELECT studied_on, SUM(seconds), CURRENT_TIMESTAMP
      FROM ${STUDY_TIME_TABLE}
      GROUP BY studied_on
      ON CONFLICT(studied_on) DO UPDATE SET
        seconds = excluded.seconds,
        updated_at = CURRENT_TIMESTAMP
    `);
    db.run("RELEASE rebuild_study_time");
  } catch (error) {
    db.run("ROLLBACK TO rebuild_study_time");
    db.run("RELEASE rebuild_study_time");
    throw error;
  }
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
      AND NOT EXISTS (
        SELECT 1 FROM sync_tombstones s
        WHERE s.table_name = '${STUDY_TIME_TABLE}'
          AND substr(s.row_key, 1, length(t.studied_on) + 1) = t.studied_on || char(31)
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
