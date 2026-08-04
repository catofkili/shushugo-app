import { beforeEach, describe, expect, it, vi } from "vitest";
import { Preferences } from "@capacitor/preferences";
import type { WordCard } from "../types/vocabulary";
import { clearQuickStudyDraft, loadQuickStudyDraft, saveQuickStudyDraft } from "./quick-study-draft";

const preferenceStore = vi.hoisted(() => new Map<string, string>());

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: preferenceStore.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { preferenceStore.set(key, value); }),
    remove: vi.fn(async ({ key }: { key: string }) => { preferenceStore.delete(key); })
  }
}));

const browserStore = new Map<string, string>();

const card = (id: number) => ({
  id,
  meaning: `意思 ${id}`,
  primaryMeaning: `意思 ${id}`,
  promptMeaning: `意思 ${id}`,
  kana: `かな${id}`,
  kanji: `漢字${id}`,
  pos: "动词",
  jlptLevel: "N3",
  score: 0,
  importance: 1,
  importanceScore: 1,
  isFavorite: false,
  note: "",
  example: { jp: "", meaning: "" },
  kanjiComponents: [],
  conjugations: [],
  confusions: []
}) satisfies WordCard;

beforeEach(() => {
  browserStore.clear();
  preferenceStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => browserStore.get(key) ?? null,
    setItem: (key: string, value: string) => { browserStore.set(key, value); },
    removeItem: (key: string) => { browserStore.delete(key); }
  });
});

describe("quick study draft", () => {
  it("restores the exact unfinished page and its choices", async () => {
    await saveQuickStudyDraft({
      cards: [card(11), card(12)],
      nextCards: [card(13)],
      seenWordIds: [9, 10, 11, 12, 13],
      phase: "stage2",
      ratings: { 11: "forgot", 12: "known_forever" },
      revealedIds: [12],
      pageNumber: 4,
      selectionMode: true,
      selectedIds: [11]
    });

    const restored = await loadQuickStudyDraft();

    expect(restored?.cards.map(({ id }) => id)).toEqual([11, 12]);
    expect(restored?.nextCards.map(({ id }) => id)).toEqual([13]);
    expect(restored?.seenWordIds).toEqual([9, 10, 11, 12, 13]);
    expect(restored?.ratings).toEqual({ 11: "forgot", 12: "known_forever" });
    expect(restored?.revealedIds).toEqual([12]);
    expect(restored?.pageNumber).toBe(4);
    expect(restored?.phase).toBe("stage2");
    expect(restored?.selectionMode).toBe(true);
    expect(restored?.selectedIds).toEqual([11]);
  });

  it("does not resurrect a stale native copy after the page was submitted", async () => {
    await saveQuickStudyDraft({
      cards: [card(21)],
      nextCards: [],
      seenWordIds: [21],
      phase: "stage1",
      ratings: { 21: "fuzzy" },
      revealedIds: [],
      pageNumber: 1,
      selectionMode: false,
      selectedIds: []
    });
    const staleNativeCopy = [...preferenceStore.values()][0];

    await clearQuickStudyDraft();
    await Preferences.set({ key: "mn-quick-study-draft", value: staleNativeCopy });

    expect(await loadQuickStudyDraft()).toBeNull();
  });
});
