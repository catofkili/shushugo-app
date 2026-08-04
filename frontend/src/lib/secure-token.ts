import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";

const TOKEN_KEY = "mn_cloud_sync_token";
let secureStorageReady: Promise<void> | null = null;

const prepareSecureStorage = (): Promise<void> => {
  if (!secureStorageReady) {
    secureStorageReady = (async () => {
      await SecureStorage.setKeyPrefix("master_nihongo_");
      await SecureStorage.setSynchronize(false);
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
    })();
  }
  return secureStorageReady;
};

export async function getCloudAccessToken(): Promise<string | undefined> {
  if (!Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    return value ?? undefined;
  }

  await prepareSecureStorage();
  const secureToken = await SecureStorage.getItem(TOKEN_KEY);
  if (secureToken) return secureToken;

  // 一次性迁移旧版本保存在 Preferences 中的 token，成功后立即清除明文副本。
  const { value: legacyToken } = await Preferences.get({ key: TOKEN_KEY });
  if (!legacyToken) return undefined;
  await SecureStorage.setItem(TOKEN_KEY, legacyToken);
  await Preferences.remove({ key: TOKEN_KEY });
  return legacyToken;
}

export async function setCloudAccessToken(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await Preferences.set({ key: TOKEN_KEY, value: token });
    return;
  }

  await prepareSecureStorage();
  await SecureStorage.setItem(TOKEN_KEY, token);
  await Preferences.remove({ key: TOKEN_KEY });
}

export async function removeCloudAccessToken(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await prepareSecureStorage();
    await SecureStorage.removeItem(TOKEN_KEY);
  }
  await Preferences.remove({ key: TOKEN_KEY });
}
