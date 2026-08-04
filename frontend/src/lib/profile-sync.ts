import { Preferences } from "@capacitor/preferences";
import { getCloudSession, getCloudUserProfile, updateCloudUserProfile, type CloudSession } from "./sync-api";
import { loadUserProfile, normalizeTargetLevel, saveUserProfile, type UserProfile } from "./userProfile";

const PENDING_PROFILE_SYNC_KEY_PREFIX = "mn_profile_sync_pending:";

const pendingKey = (email: string) => `${PENDING_PROFILE_SYNC_KEY_PREFIX}${encodeURIComponent(email.toLowerCase())}`;

const markPending = (email: string, pending: boolean) => (
  pending
    ? Preferences.set({ key: pendingKey(email), value: "true" })
    : Preferences.remove({ key: pendingKey(email) })
);

const push = async (profile: UserProfile, email: string): Promise<UserProfile> => {
  await markPending(email, true);
  const remote = await updateCloudUserProfile({
    displayName: profile.nickname,
    bio: profile.bio,
    targetLevel: profile.targetLevel,
    avatar: profile.avatar ?? null
  });
  const next: UserProfile = {
    ...profile,
    profileUpdatedAt: remote.profile_updated_at || new Date().toISOString()
  };
  await saveUserProfile(next);
  await markPending(email, false);
  return next;
};

const pull = async (local: UserProfile): Promise<UserProfile> => {
  const remote = await getCloudUserProfile();
  const next: UserProfile = {
    ...local,
    nickname: remote.display_name?.trim() || local.nickname,
    // 云端还没写过简介的账号（新注册、或只在别处登录过）会返回 null，
    // 直接落成 "" 等于一登录就把本机写好的简介抹掉。
    bio: remote.bio ?? local.bio,
    avatar: remote.avatar || undefined,
    targetLevel: normalizeTargetLevel(remote.target_level || local.targetLevel),
    profileUpdatedAt: remote.profile_updated_at || local.profileUpdatedAt
  };
  await saveUserProfile(next);
  return next;
};

export async function saveUserProfileToCloud(profile?: UserProfile): Promise<UserProfile> {
  const session = await getCloudSession();
  const local = profile ?? await loadUserProfile();
  if (!session.token || !session.email) return local;
  return push(local, session.email);
}

export async function syncUserProfileAfterLogin(session: CloudSession): Promise<UserProfile> {
  let local = await loadUserProfile();
  if (session.isNewAccount) {
    if (session.displayName && local.nickname === "Master 用户") {
      local = { ...local, nickname: session.displayName, profileUpdatedAt: new Date().toISOString() };
      await saveUserProfile(local);
    }
    if (!session.email) return local;
    return push(local, session.email);
  }
  if (!session.email) return local;
  const { value: pending } = await Preferences.get({ key: pendingKey(session.email) });
  return pending === "true" ? push(local, session.email) : pull(local);
}

export async function refreshUserProfileFromCloud(): Promise<UserProfile> {
  const local = await loadUserProfile();
  const session = await getCloudSession();
  if (!session.token || !session.email) return local;
  const { value: pending } = await Preferences.get({ key: pendingKey(session.email) });
  return pending === "true" ? push(local, session.email) : pull(local);
}

export async function flushPendingUserProfileSync(): Promise<void> {
  const session = await getCloudSession();
  if (!session.token || !session.email || !navigator.onLine) return;
  const { value: pending } = await Preferences.get({ key: pendingKey(session.email) });
  if (pending !== "true") return;
  await push(await loadUserProfile(), session.email);
}
