import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mascotSkinReady } from "../components/CapybaraMascot";
import { availableVoices } from "./speech";
import { itemAvailable } from "./shop-availability";
import type { YuzuItem } from "./yuzu-catalog";

vi.mock("../components/CapybaraMascot", () => ({ mascotSkinReady: vi.fn() }));
vi.mock("./speech", () => ({ availableVoices: vi.fn() }));

const makeItem = (id: string, category: YuzuItem["category"], soon?: true): YuzuItem => ({
  id, name: id, description: "", category, price: 100, ...(soon ? { soon } : {})
});

let audioWindow: { AudioContext?: unknown; webkitAudioContext?: unknown };

beforeEach(() => {
  vi.mocked(availableVoices).mockReturnValue([]);
  vi.mocked(mascotSkinReady).mockReturnValue(false);
  audioWindow = { AudioContext: undefined, webkitAudioContext: undefined };
  vi.stubGlobal("window", audioWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("itemAvailable", () => {
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
