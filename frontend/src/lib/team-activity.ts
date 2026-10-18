import { firstValue, today } from "./database/db-utils";
import { getDatabase } from "./database";
import {
  getCloudSession, getCloudTeamRewards, updateCloudTeamTitle, getLocalSyncOwnerEmail, reportCloudTeamActivity,
  type CloudTeam, type CloudTeamActivity, type CloudTeamPlazaItem
} from "./sync-api";
import { teamDayPassed } from "./team-rules";
import { equippedItem, YUZU_EVENT, bookTeamReward } from "./yuzu";

const tableExists = (table: string) => Number(firstValue(
  "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table], 0
)) > 0;

/** 沿用已落库的有效秒数；词只按 word_id 去重，三个方向都算，语法和汉字单元另列。 */
export const localActivity = (): CloudTeamActivity => {
  const studyDay = today();
  const count = (table: string) => tableExists(table)
    ? Number(firstValue(`SELECT COUNT(*) FROM ${table} WHERE reviewed_on = ?`, [studyDay], 0)) : 0;
  return {
    studyDay,
    studyCount: Math.min(5000, count("reviews") + count("grammar_reviews") + count("kanji_unit_reviews")),
    completed: tableExists("checkins") && Number(firstValue("SELECT COUNT(*) FROM checkins WHERE checked_on = ?", [studyDay], 0)) > 0,
    wordCount: tableExists("reviews") ? Math.min(5000, Number(firstValue("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?", [studyDay], 0))) : 0,
    activeMinutes: tableExists("word_study_time") ? Math.min(1440, Math.floor(Number(firstValue("SELECT seconds FROM word_study_time WHERE studied_on = ?", [studyDay], 0)) / 60)) : 0
  };
};

// 按账号存，换号不会看到别人的队伍。缓存同时是后台上报的闸门，避免非队员发云请求。
const TEAM_CACHE_KEY = "mn-team-page-cache";
type TeamCache = { owner: string; team: CloudTeam | null; plaza: CloudTeamPlazaItem[] };
export const readTeamCache = (owner: string | undefined): TeamCache | null => {
  if (!owner) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(TEAM_CACHE_KEY) ?? "null") as TeamCache | null;
    return cached?.owner === owner && Array.isArray(cached.plaza) ? cached : null;
  } catch { return null; }
};
export const writeTeamCache = (owner: string | undefined, team: CloudTeam | null, plaza: CloudTeamPlazaItem[]) => {
  if (!owner) return;
  try { localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify({ owner, team, plaza })); } catch { /* 缓存只是提速 */ }
};

const activityKey = (owner: string) => `mn-team-last-activity:${owner}`;
export const rememberTeamActivity = (owner: string | undefined, activity: CloudTeamActivity) => {
  if (!owner) return;
  try { localStorage.setItem(activityKey(owner), JSON.stringify({ at: Date.now(), activity })); } catch { /* 无缓存时仍可上报 */ }
};
const shouldReport = (owner: string, activity: CloudTeamActivity): boolean => {
  try {
    const last = JSON.parse(localStorage.getItem(activityKey(owner)) ?? "null") as { at: number; activity: CloudTeamActivity } | null;
    return !last || last.activity.studyDay !== activity.studyDay || Date.now() - last.at >= 5 * 60_000
      || JSON.stringify(last.activity) !== JSON.stringify(activity);
  } catch { return true; }
};

let reporting: Promise<void> | null = null;
let reportPending = false;
export const reportTeamActivity = (): Promise<void> => {
  if (reporting) { reportPending = true; return reporting; }
  reporting = (async () => {
    do {
      reportPending = false;
      const session = await getCloudSession();
      if (!session.token || !session.email) return;
      const cached = readTeamCache(session.email);
      if (!cached?.team) return;
      const owner = await getLocalSyncOwnerEmail();
      if (owner && owner !== session.email) return;
      const activity = localActivity();
      if (!shouldReport(session.email, activity)) return;
      const team = await reportCloudTeamActivity(activity);
      if ((await getCloudSession()).email !== session.email || readTeamCache(session.email)?.team?.id !== cached.team.id) return;
      writeTeamCache(session.email, team, cached.plaza);
      rememberTeamActivity(session.email, activity);
      // A completion flush can arrive during the cloud request; drain it before resolving.
    } while (reportPending);
  })().catch(() => undefined).finally(() => { reporting = null; });
  return reporting;
};

export const teamCheckedIn = (day = today()): boolean => Number(firstValue(
  "SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'team_checkin' AND key = ?", [day], 0
)) > 0;

export const claimTeamCheckin = async (): Promise<boolean> => {
  const session = await getCloudSession();
  if (!session.token || !readTeamCache(session.email)?.team) return false;
  const owner = await getLocalSyncOwnerEmail();
  if (owner && owner !== session.email) return false;
  const current = await getCloudSession();
  if (current.token !== session.token || current.email !== session.email || !readTeamCache(session.email)?.team) return false;
  const activity = localActivity();
  return teamDayPassed(activity.wordCount, activity.activeMinutes)
    && bookTeamReward("team_checkin", activity.studyDay, 20);
};

/** 服务端给结算行，本地账本天然幂等；切号或换库时丢弃这次响应。 */
export const collectTeamRewards = async (): Promise<number> => {
  const session = await getCloudSession();
  if (!session.token || !session.email) return 0;
  const owner = await getLocalSyncOwnerEmail();
  if (owner && owner !== session.email) return 0;
  const db = getDatabase();
  const rewards = await getCloudTeamRewards();
  const current = await getCloudSession();
  if (current.email !== session.email || current.token !== session.token || getDatabase() !== db) return 0;
  let amount = 0;
  for (const row of rewards.periods) {
    if (bookTeamReward("team_period", `${row.team_id}:${row.period_start}`, row.amount)) amount += row.amount;
  }
  for (const row of rewards.wins) {
    if (bookTeamReward("duel_win", row.iso_week, 150)) amount += 150;
  }
  return amount;
};

/** 页面入口传服务端快照，只推差异；商店换装备时不额外 GET，未入队 / 旧服务端的 404 也静默。 */
export const syncTeamTitle = async (team?: CloudTeam | null): Promise<string | null | undefined> => {
  try {
    const title = equippedItem("title");
    if (team !== undefined) {
      const me = team?.members.find((member) => member.isMe);
      if (!me || (me.title ?? "") === title) return;
    }
    const db = getDatabase();
    const session = await getCloudSession();
    if (!session.token || !session.email) return;
    const owner = await getLocalSyncOwnerEmail();
    if (owner && owner !== session.email) return;
    const current = await getCloudSession();
    if (current.token !== session.token || current.email !== session.email || getDatabase() !== db || equippedItem("title") !== title) return;
    const saved = await updateCloudTeamTitle(title);
    const after = await getCloudSession();
    if (after.token === session.token && after.email === session.email && getDatabase() === db && equippedItem("title") === title) return saved;
  } catch { /* 外观同步失败留到下次进入队伍页重试，不打扰学习。 */ }
};

/** 只跟踪称号槽变化；购买 / 装备会连发事件，且快速换装的写请求必须依次完成。 */
export const watchTeamTitle = (onSynced?: (title: string | null) => void): (() => void) => {
  let last = equippedItem("title");
  let pending = Promise.resolve();
  let active = true;
  const update = () => {
    const title = equippedItem("title");
    if (title === last) return;
    last = title;
    pending = pending.then(async () => {
      const saved = await syncTeamTitle();
      if (active && saved !== undefined) onSynced?.(saved);
    });
  };
  window.addEventListener(YUZU_EVENT, update);
  return () => { active = false; window.removeEventListener(YUZU_EVENT, update); };
};
