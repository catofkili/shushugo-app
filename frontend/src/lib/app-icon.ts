import { Capacitor, registerPlugin } from "@capacitor/core";
import { getState } from "./database/db-utils";

interface AppIconPlugin {
  getCurrent(): Promise<{ name: string | null }>;
  set(options: { name: string | null }): Promise<void>;
}

const AppIcon = registerPlugin<AppIconPlugin>("AppIcon");
const iconNames: Record<string, string> = { "icon-happy": "AppIconHappy", "icon-onsen": "AppIconOnsen" };
let pending = Promise.resolve();

export const appIconAvailable = (): boolean =>
  Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("AppIcon");

export function setAppIcon(itemId: string): Promise<void> {
  if (!appIconAvailable() || (itemId !== "" && !iconNames[itemId])) return Promise.resolve();
  const name = iconNames[itemId] ?? null;
  // 串行读取原生状态：快速重复点击也不能重复弹 iOS 的换图标提示。
  pending = pending.then(async () => {
    if ((await AppIcon.getCurrent()).name !== name) await AppIcon.set({ name });
  }).catch(() => { /* 系统拒绝不影响商店；下次启动再对账。 */ });
  return pending;
}

export async function syncAppIcon(): Promise<void> {
  if (!appIconAvailable()) return;
  try { await setAppIcon(getState("yuzu_equipped:icon", "")); }
  catch { /* 老库尚未就位时不阻断启动。 */ }
}
