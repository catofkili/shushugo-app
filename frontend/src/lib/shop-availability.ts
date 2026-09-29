import { mascotSkinReady } from "../components/CapybaraMascot";
import { availableVoices } from "./speech";
import { soundAvailable } from "./zoo-sounds";
import { VOICE_ITEM_PREFIX, type YuzuItem } from "./yuzu-catalog";

export function itemAvailable(item: YuzuItem): boolean {
  if (item.soon) return false;
  if (item.category === "voice") {
    const voiceId = item.id.replace(VOICE_ITEM_PREFIX, "");
    return availableVoices().some((voice) => voice.id === voiceId);
  }
  if (item.category === "sound") return soundAvailable();
  if (item.category === "mascot") return mascotSkinReady(item.id);
  return true;
}
