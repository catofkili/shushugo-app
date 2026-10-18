import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mascotSkinReady } from "../components/CapybaraMascot";
import { availableVoices } from "./speech";
import { itemAvailable } from "./shop-availability";
import type { YuzuItem } from "./yuzu-catalog";
import { Capacitor } from "@capacitor/core";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn(), isPluginAvailable: vi.fn() },
  registerPlugin: vi.fn(() => ({}))
}));

vi.mock("../components/CapybaraMascot", () => ({ mascotSkinReady: vi.fn() }));
vi.mock("./speech", () => ({ availableVoices: vi.fn() }));

const makeItem = (id: string, category: YuzuItem["category"], soon?: true): YuzuItem => ({
  id, name: id, description: "", category, price: 100, ...(soon ? { soon } : {})
});

let audioWindow: { AudioContext?: unknown; webkitAudioContext?: unknown };

beforeEach(() => {
  vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
  vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  vi.mocked(availableVoices).mockReturnValue([]);
  vi.mocked(mascotSkinReady).mockReturnValue(false);
  audioWindow = { AudioContext: undefined, webkitAudioContext: undefined };
  vi.stubGlobal("window", audioWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("itemAvailable", () => {
  it("offers icons only on iOS with the native plugin, keeping soon first", () => {
    const icon = makeItem("icon-happy", "icon");
    for (const platform of ["web", "android", "wechat"]) {
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
      vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
      expect(itemAvailable(icon)).toBe(false);
    }
    vi.mocked(Capacitor.getPlatform).mockReturnValue("ios");
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    expect(itemAvailable(icon)).toBe(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    expect(itemAvailable(icon)).toBe(true);
    expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith("AppIcon");
    expect(itemAvailable(makeItem("icon-happy", "icon", true))).toBe(false);
  });

  it("keeps soon items unavailable", () => {
    expect(itemAvailable(makeItem("walk-alt", "misc", true))).toBe(false);
  });

  it("requires the voice to exist in the loaded audio index", () => {
    const voice = makeItem("voice-voicevox-10", "voice");
    expect(itemAvailable(voice)).toBe(false);
    vi.mocked(availableVoices).mockReturnValue([{ id: "voicevox-10", label: "雨晴はう", ext: ".wav" }]);
    expect(itemAvailable(voice)).toBe(true);
  });

  it("requires Web Audio support for sound items", () => {
    expect(itemAvailable(makeItem("sound-marimba", "sound"))).toBe(false);
    audioWindow.AudioContext = class AudioContextStub {};
    expect(itemAvailable(makeItem("sound-marimba", "sound"))).toBe(true);
  });

  it("requires the mascot skin to be ready", () => {
    const mascot = makeItem("mascot-croc", "mascot");
    expect(itemAvailable(mascot)).toBe(false);
    vi.mocked(mascotSkinReady).mockReturnValue(true);
    expect(itemAvailable(mascot)).toBe(true);
  });

  it("keeps theme and repair items available", () => {
    expect(itemAvailable(makeItem("theme-matcha", "theme"))).toBe(true);
    expect(itemAvailable(makeItem("repair", "misc"))).toBe(true);
  });
});
