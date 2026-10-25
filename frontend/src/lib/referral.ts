import { getDatabase } from "./database";
import { firstValue, rowsFor, today } from "./database/db-utils";
import { getDeviceId } from "./sync/schema";
import { getCloudSession, getLocalSyncOwnerEmail, teamRequest } from "./sync-api";
import { bookReferralReward, grantReferralSet, yuzuBalance } from "./yuzu";
import { shiftDay } from "./zoo-streak";

export type ReferralClaim = { claimedDay: string; windowEndDay: string; setUnlocked: boolean };
export type Referral = {
  code: string; invitedCount: number; qualifiedCount: number; inviterEarned: number; inviterCap: number;
  setUnlocked: boolean; canClaim: boolean; claim: ReferralClaim | null;
  rewards: { id: number; amount: number }[];
};
export const REFERRAL_EVENT = "shushugo:referral";
export const REFERRAL_BANNER_KEY = "referral_banner_dismissed";
const claimKey = (email: string) => `mn-referral-claimed:${email}`;
const emit = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(REFERRAL_EVENT)); };

const context = async () => {
  const db = getDatabase();
  const session = await getCloudSession();
  if (!session.token || !session.email) return null;
  const owner = await getLocalSyncOwnerEmail();
  if ((owner && owner !== session.email) || getDatabase() !== db) return null;
  return { db, email: session.email, token: session.token };
};
const current = async (ctx: NonNullable<Awaited<ReturnType<typeof context>>>) => {
  const session = await getCloudSession();
  const owner = await getLocalSyncOwnerEmail();
  return session.email === ctx.email && session.token === ctx.token && getDatabase() === ctx.db
    && (!owner || owner === ctx.email);
};
const remember = (email: string, claim: ReferralClaim | null) => {
  if (claim) {
    try { localStorage.setItem(claimKey(email), "1"); } catch { /* 缓存不影响绑定。 */ }
  }
  emit();
};

export const fetchReferral = async (): Promise<Referral | null> => {
  try {
    const ctx = await context();
    if (!ctx || !await current(ctx)) return null;
    const result = await teamRequest<Referral>(`/api/referral/me?deviceId=${encodeURIComponent(getDeviceId())}`);
    if (!await current(ctx)) return null;
    remember(ctx.email, result.claim);
    return result;
  } catch { return null; }
};

// 用户主动确认时保留服务端中文 detail（teamRequest 的 Error.message），后台同步才静默。
export const claimReferral = async (code: string): Promise<ReferralClaim | null> => {
  const ctx = await context();
  if (!ctx || !await current(ctx)) return null;
  try {
    const result = await teamRequest<{ claim: ReferralClaim }>("/api/referral/claim", "POST", {
      code: code.trim().toUpperCase(), deviceId: getDeviceId(), studyDay: today()
    });
    if (!await current(ctx)) return null;
    remember(ctx.email, result.claim);
    return result.claim;
  } catch (error) {
    if (!await current(ctx)) return null;
    throw error;
  }
};

export const normalReferralEarnings = (claim: ReferralClaim) => rowsFor(`
  SELECT kind, key, day, amount FROM yuzu_ledger
  WHERE kind IN ('study', 'plan', 'streak', 'encore', 'focus') AND amount > 0
    AND day >= ? AND day <= ? ORDER BY day, kind, key`, [claim.claimedDay, claim.windowEndDay])
  .map((row) => ({ kind: String(row.kind), key: String(row.key), day: String(row.day), amount: Number(row.amount) }));

// 按库和登录令牌隔离；并发调用在第一次请求发出之前就占住十分钟窗口。
const attempts = new WeakMap<ReturnType<typeof getDatabase>, Map<string, number>>();
export const syncReferral = async (): Promise<void> => {
  try {
    const ctx = await context();
    if (!ctx || !await current(ctx)) return;
    let sessions = attempts.get(ctx.db);
    if (!sessions) { sessions = new Map(); attempts.set(ctx.db, sessions); }
    const key = `${ctx.email}:${ctx.token}`;
    const last = sessions.get(key);
    if (last !== undefined && Date.now() - last < 10 * 60_000) return;
    sessions.set(key, Date.now());
    const me = await teamRequest<Referral>(`/api/referral/me?deviceId=${encodeURIComponent(getDeviceId())}`);
    if (!await current(ctx)) return;
    for (const reward of me.rewards) bookReferralReward("referral_inviter", String(reward.id), reward.amount);
    if (me.setUnlocked) grantReferralSet();
    remember(ctx.email, me.claim);
    if (!me.claim) return;
    // 先完成旧面额迁移，再读正常收入，免得第一次邀请结算读到旧金额。
    yuzuBalance();
    const rows = normalReferralEarnings(me.claim);
    for (const row of rows) bookReferralReward("referral_invitee", `${row.kind}:${row.key}`, row.amount);
    // 即使没有收入也发空批次，让服务端有机会返回学习天数带来的解锁。
    for (let offset = 0; offset < Math.max(rows.length, 1); offset += 500) {
      if (!await current(ctx)) return;
      const result = await teamRequest<{ accepted: number; setUnlocked: boolean }>("/api/referral/earnings", "POST", { rows: rows.slice(offset, offset + 500) });
      if (!await current(ctx)) return;
      if (result.setUnlocked) grantReferralSet();
    }
  } catch { /* 断网、旧服务端或无绑定时，留待下次首页同步。 */ }
};

export const referralBannerVisible = async (): Promise<boolean> => {
  try {
    if (localStorage.getItem(REFERRAL_BANNER_KEY) === "1") return false;
    const db = getDatabase();
    const session = await getCloudSession();
    if (getDatabase() !== db || (session.email && localStorage.getItem(claimKey(session.email)) === "1")) return false;
    const days: string[] = [];
    for (const [table, column] of [
      ["reviews", "reviewed_on"], ["grammar_reviews", "reviewed_on"], ["kanji_unit_reviews", "reviewed_on"],
      ["kanji_char_reviews", "reviewed_on"], ["confusion_reviews", "reviewed_on"], ["kana_reviews", "reviewed_on"],
      ["spelling_reviews", "reviewed_on"], ["talk_reviews", "reviewed_on"], ["word_study_time", "studied_on"]
    ]) {
      if (!firstValue("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [table], 0)) continue;
      const day = firstValue<string>(`SELECT MIN(${column}) FROM ${table}${table === "word_study_time" ? " WHERE seconds > 0" : ""}`, [], "");
      if (day) days.push(day);
    }
    return !days.length || days.sort()[0] >= shiftDay(today(), -6);
  } catch { return false; }
};
