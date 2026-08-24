import { Preferences } from '@capacitor/preferences';
import { notifyAchievement } from './notifications';
import { evaluateAchievements } from "./achievements";
import type { Achievement } from "./achievements/catalog";
export interface UserProfile {
  nickname: string;
  bio: string;
  avatar?: string; // Base64 编码的头像
  targetLevel: string;
  /**
   * @deprecated 学习时长和天数一律以数据库为准，见 study-totals.ts。
   * 这两个字段留着只是为了不破坏已经存下来的 JSON，谁都不该再读它们。
   */
  studyTimeMinutes?: number;
  /** @deprecated 同上 */
  studyDays?: number;
  lastStudyDate?: string; // 最后学习日期 (YYYY-MM-DD)
  createdAt: string; // 创建时间
  profileUpdatedAt: string; // 昵称、头像、简介或目标最后修改时间
  /**
   * @deprecated 老的成就名单（默认就白送「新手」「学习者」两个，判据也基本触发不了）。
   * 现在的成就在数据库 achievements 表里，见 lib/achievements/。留着字段只为兼容旧 JSON。
   */
  achievements: string[];
}

export const TARGET_LEVEL_OPTIONS = ["N5", "N4", "N3", "N2", "N1", "旅游", "没有目标"] as const;
export type TargetLevelOption = typeof TARGET_LEVEL_OPTIONS[number];

export const normalizeTargetLevel = (value: string): TargetLevelOption => {
  return TARGET_LEVEL_OPTIONS.includes(value as TargetLevelOption) ? value as TargetLevelOption : "N5";
};

const DEFAULT_PROFILE: UserProfile = {
  nickname: '收集日用户',
  bio: '正在学习日语中...',
  targetLevel: 'N5',
  createdAt: new Date().toISOString(),
  profileUpdatedAt: new Date().toISOString(),
  achievements: ['新手', '学习者'],
};

const STORAGE_KEY = 'user_profile';

// 保存用户资料
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  try {
    await Preferences.set({
      key: STORAGE_KEY,
      value: JSON.stringify(profile),
    });
    console.log('✅ User profile saved');
  } catch (error) {
    console.error('❌ Failed to save user profile:', error);
    throw error;
  }
}

// 加载用户资料
export async function loadUserProfile(): Promise<UserProfile> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });

    if (!value) {
      console.log('No saved profile found, using default');
      return DEFAULT_PROFILE;
    }

    const profile = JSON.parse(value) as UserProfile;
    profile.targetLevel = normalizeTargetLevel(profile.targetLevel);
    profile.profileUpdatedAt = profile.profileUpdatedAt || profile.createdAt || new Date(0).toISOString();
    console.log('✅ User profile loaded');
    return profile;
  } catch (error) {
    console.error('❌ Failed to load user profile:', error);
    return DEFAULT_PROFILE;
  }
}

// 更新基本信息
export async function updateBasicInfo(nickname: string, bio: string): Promise<void> {
  const profile = await loadUserProfile();
  profile.nickname = nickname;
  profile.bio = bio;
  profile.profileUpdatedAt = new Date().toISOString();
  await saveUserProfile(profile);
}

// 更新头像
export async function updateAvatar(avatarBase64: string): Promise<void> {
  const profile = await loadUserProfile();
  profile.avatar = avatarBase64;
  profile.profileUpdatedAt = new Date().toISOString();
  await saveUserProfile(profile);
}

// 更新目标等级
export async function updateTargetLevel(targetLevel: string): Promise<void> {
  const profile = await loadUserProfile();
  profile.targetLevel = normalizeTargetLevel(targetLevel);
  profile.profileUpdatedAt = new Date().toISOString();
  await saveUserProfile(profile);
}

/** 成就解锁时广播一下，App 那层接住弹提示 */
export const ACHIEVEMENT_UNLOCKED_EVENT = "shushugo:achievement-unlocked";

// 格式化学习时长
export function formatStudyTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} 小时 ${mins} 分钟`;
}

// 检查并解锁成就。判据和解锁记录都在 achievements 模块里，这里只负责「广播出去」。
export async function checkAchievements(options: { force?: boolean } = {}): Promise<Achievement[]> {
  const earned = evaluateAchievements(options);
  earned.forEach((achievement) => {
    notifyAchievement(`${achievement.emoji} ${achievement.name}`).catch(() => undefined);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ACHIEVEMENT_UNLOCKED_EVENT, { detail: achievement }));
    }
  });
  return earned;
}
