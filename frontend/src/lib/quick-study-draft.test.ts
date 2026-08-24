import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Preferences } from "@capacitor/preferences";
import type { WordCard } from "../types/vocabulary";
import { clearQuickStudyDraft, loadQuickStudyDraft, saveQuickStudyDraft } from "./quick-study-draft";
import { studyDate } from "./database/db-utils";

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

afterEach(() => {
  vi.useRealTimers();
});

describe("quick study draft", () => {
  it("restores the exact unfinished page and its choices", async () => {
    await saveQuickStudyDraft({
      studyDate: studyDate(),
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

  it("defaults an unrated quick-study card to know", async () => {
    await saveQuickStudyDraft({
      studyDate: studyDate(),
      cards: [card(14)],
      nextCards: [],
      seenWordIds: [14],
      phase: "stage1",
      ratings: {},
      revealedIds: [],
      pageNumber: 1,
      selectionMode: false,
      selectedIds: []
    });

    expect((await loadQuickStudyDraft())?.ratings).toEqual({ 14: "know" });
  });

  it("discards a v2 page whose fuzzy ratings came from the old default", async () => {
    const staleDraft = JSON.stringify({
      version: 2,
      studyDate: studyDate(),
      cards: [card(15)],
      nextCards: [],
      seenWordIds: [15],
      phase: "stage1",
      ratings: { 15: "fuzzy" },
      revealedIds: [],
      pageNumber: 1,
      selectionMode: false,
      selectedIds: [],
      updatedAt: new Date().toISOString()
    });
    browserStore.set("mn-quick-study-draft", staleDraft);
    preferenceStore.set("mn-quick-study-draft", staleDraft);

    expect(await loadQuickStudyDraft()).toBeNull();
    expect(browserStore.get("mn-quick-study-draft")).toContain('"cleared":true');
    expect(preferenceStore.has("mn-quick-study-draft")).toBe(false);
  });

  it("does not resurrect a stale native copy after the page was submitted", async () => {
    await saveQuickStudyDraft({
      studyDate: studyDate(),
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

  it("keeps an unfinished page within the same study day and expires it at 4am", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-18T03:30:00+08:00"));
    const draftDate = studyDate();
    await saveQuickStudyDraft({
      studyDate: draftDate,
      cards: [card(31)],
      nextCards: [card(32)],
      seenWordIds: [31, 32],
      phase: "stage1",
      ratings: { 31: "forgot" },
      revealedIds: [31],
      pageNumber: 2,
      selectionMode: false,
      selectedIds: []
    });

    vi.setSystemTime(new Date("2026-08-18T03:59:59+08:00"));
    expect((await loadQuickStudyDraft())?.cards.map(({ id }) => id)).toEqual([31]);

    vi.setSystemTime(new Date("2026-08-18T04:00:00+08:00"));
    expect(await loadQuickStudyDraft()).toBeNull();
    expect(browserStore.get("mn-quick-study-draft")).toContain('"cleared":true');
    expect(preferenceStore.has("mn-quick-study-draft")).toBe(false);
  });
});
