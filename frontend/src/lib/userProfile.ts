import { Preferences } from '@capacitor/preferences';
import { notifyAchievement } from './notifications';

export interface UserProfile {
  nickname: string;
  bio: string;
  avatar?: string; // Base64 编码的头像
  targetLevel: string;
  studyTimeMinutes: number; // 学习总时长（分钟）
  studyDays: number; // 学习天数
  lastStudyDate?: string; // 最后学习日期 (YYYY-MM-DD)
  createdAt: string; // 创建时间
  achievements: string[]; // 已获得的成就
}

const DEFAULT_PROFILE: UserProfile = {
  nickname: 'Master 用户',
  bio: '正在学习日语中...',
  targetLevel: 'N5 → N3',
  studyTimeMinutes: 0,
  studyDays: 0,
  createdAt: new Date().toISOString(),
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
  await saveUserProfile(profile);
}

// 更新头像
export async function updateAvatar(avatarBase64: string): Promise<void> {
  const profile = await loadUserProfile();
  profile.avatar = avatarBase64;
  await saveUserProfile(profile);
}

// 更新目标等级
export async function updateTargetLevel(targetLevel: string): Promise<void> {
  const profile = await loadUserProfile();
  profile.targetLevel = targetLevel;
  await saveUserProfile(profile);
}

// 记录学习时间（分钟）
export async function addStudyTime(minutes: number): Promise<void> {
  const profile = await loadUserProfile();
  profile.studyTimeMinutes += minutes;

  // 检查是否是新的一天
  const today = new Date().toISOString().split('T')[0];
  if (profile.lastStudyDate !== today) {
    profile.studyDays += 1;
    profile.lastStudyDate = today;
  }

  await saveUserProfile(profile);
}

// 添加成就
export async function addAchievement(achievement: string): Promise<void> {
  const profile = await loadUserProfile();
  if (!profile.achievements.includes(achievement)) {
    profile.achievements.push(achievement);
    await saveUserProfile(profile);
    notifyAchievement(achievement).catch(() => undefined);
  }
}

// 格式化学习时长
export function formatStudyTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} 小时 ${mins} 分钟`;
}

// 检查并解锁成就
export async function checkAchievements(): Promise<string[]> {
  const profile = await loadUserProfile();
  const newAchievements: string[] = [];

  // 坚持者：连续学习 7 天
  if (profile.studyDays >= 7 && !profile.achievements.includes('坚持者')) {
    await addAchievement('坚持者');
    newAchievements.push('坚持者');
  }

  // 大师：学习超过 100 小时
  if (profile.studyTimeMinutes >= 6000 && !profile.achievements.includes('大师')) {
    await addAchievement('大师');
    newAchievements.push('大师');
  }

  return newAchievements;
}
