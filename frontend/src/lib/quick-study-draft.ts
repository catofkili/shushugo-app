import { Preferences } from "@capacitor/preferences";
import type { WordAnswer, WordCard } from "../types/vocabulary";
import { studyDate as currentStudyDate } from "./database/db-utils";

const STORAGE_KEY = "mn-quick-study-draft";
// v3 把快速学习默认值从「模糊」改为「认识」。v2 会为整页显式保存 fuzzy，
// 仅修改代码默认值无法覆盖它，因此必须让旧草稿失效并按当天队列重建一次。
const DRAFT_VERSION = 3;
const VALID_ANSWERS = new Set<WordAnswer>(["forgot", "fuzzy", "know", "known_forever"]);
/** 与 QuickStudyPanel 一致：快速学习打开后默认按「认识」准备，用户可逐项改判。 */
const DEFAULT_ANSWER: WordAnswer = "know";

export interface QuickStudyDraft {
  version: 3;
  studyDate: string;
  /** 快速模式排片规则版本；缺失表示旧的随机顺序草稿。 */
  orderVersion?: number;
  cards: WordCard[];
  nextCards: WordCard[];
  seenWordIds: number[];
  phase: string;
  ratings: Record<number, WordAnswer>;
  revealedIds: number[];
  pageNumber: number;
  selectionMode: boolean;
  selectedIds: number[];
  updatedAt: string;
}

type ClearedDraft = {
  version: 1 | 2 | 3;
  cleared: true;
};

let preferenceWriteQueue: Promise<void> = Promise.resolve();

const readBrowserCopy = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeBrowserCopy = (value: string) => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (error) {
    console.warn("[quick-study] 无法写入浏览器草稿", error);
  }
};

const isClearedDraft = (value: unknown): value is ClearedDraft => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClearedDraft>;
  return (
    candidate.version === 1
    || candidate.version === 2
    || candidate.version === DRAFT_VERSION
  ) && candidate.cleared === true;
};

const normalizeIds = (value: unknown, validIds: Set<number>) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(Number)
    .filter((id) => Number.isFinite(id) && validIds.has(id)))];
};

const normalizeFiniteIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(Number)
    .filter((id) => Number.isFinite(id)))]
    .slice(0, 20_000);
};

const normalizeDraft = (value: unknown): QuickStudyDraft | null => {
  if (!value || typeof value !== "object" || isClearedDraft(value)) return null;
  const candidate = value as Partial<QuickStudyDraft>;
  if (
    candidate.version !== DRAFT_VERSION
    || candidate.studyDate !== currentStudyDate()
    || !Array.isArray(candidate.cards)
    || !candidate.cards.length
  ) return null;

  const cards = candidate.cards
    .filter((card): card is WordCard => Boolean(card) && Number.isFinite(Number(card.id)))
    .slice(0, 50);
  if (!cards.length) return null;

  const currentIds = new Set(cards.map((card) => Number(card.id)));
  const nextCards = (Array.isArray(candidate.nextCards) ? candidate.nextCards : [])
    .filter((card): card is WordCard => Boolean(card) && Number.isFinite(Number(card.id)) && !currentIds.has(Number(card.id)))
    .slice(0, 50);

  const validIds = new Set(cards.map((card) => Number(card.id)));
  const sourceRatings = candidate.ratings && typeof candidate.ratings === "object" ? candidate.ratings : {};
  const ratings = Object.fromEntries(cards.map((card) => {
    const answer = sourceRatings[card.id];
    return [card.id, VALID_ANSWERS.has(answer) ? answer : DEFAULT_ANSWER];
  })) as Record<number, WordAnswer>;

  return {
    version: DRAFT_VERSION,
    studyDate: candidate.studyDate,
    orderVersion: Number.isFinite(Number(candidate.orderVersion)) ? Number(candidate.orderVersion) : 0,
    cards,
    nextCards,
    seenWordIds: [...new Set([
      ...normalizeFiniteIds(candidate.seenWordIds),
      ...cards.map((card) => card.id),
      ...nextCards.map((card) => card.id)
    ])],
    phase: typeof candidate.phase === "string" ? candidate.phase : "stage1",
    ratings,
    revealedIds: normalizeIds(candidate.revealedIds, validIds),
    pageNumber: Math.max(1, Math.floor(Number(candidate.pageNumber) || 1)),
    selectionMode: candidate.selectionMode === true,
    selectedIds: normalizeIds(candidate.selectedIds, validIds),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString()
  };
};

const parseStoredDraft = (raw: string | null): { draft: QuickStudyDraft | null; cleared: boolean } => {
  if (!raw) return { draft: null, cleared: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return { draft: normalizeDraft(parsed), cleared: isClearedDraft(parsed) };
  } catch {
    return { draft: null, cleared: false };
  }
};

const queuePreferenceWrite = (operation: () => Promise<void>) => {
  preferenceWriteQueue = preferenceWriteQueue
    .catch(() => undefined)
    .then(operation)
    .catch((error) => console.warn("[quick-study] 无法写入原生草稿", error));
  return preferenceWriteQueue;
};

export async function loadQuickStudyDraft(): Promise<QuickStudyDraft | null> {
  const browserRaw = readBrowserCopy();
  const browserCopy = parseStoredDraft(browserRaw);
  if (browserCopy.cleared) {
    void queuePreferenceWrite(() => Preferences.remove({ key: STORAGE_KEY }));
    return null;
  }
  if (browserCopy.draft) return browserCopy.draft;

  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    const nativeCopy = parseStoredDraft(value);
    if (nativeCopy.draft) {
      writeBrowserCopy(JSON.stringify(nativeCopy.draft));
      return nativeCopy.draft;
    }
    // 旧版本、旧学习日或损坏的副本不能留在另一套存储里等待下次复活。
    if (browserRaw || value) await clearQuickStudyDraft();
    return null;
  } catch (error) {
    console.warn("[quick-study] 无法读取原生草稿", error);
    return null;
  }
}

export function saveQuickStudyDraft(draft: Omit<QuickStudyDraft, "version" | "updatedAt">): Promise<void> {
  const normalized = normalizeDraft({
    ...draft,
    version: DRAFT_VERSION,
    updatedAt: new Date().toISOString()
  });
  if (!normalized) return Promise.resolve();

  const serialized = JSON.stringify(normalized);
  // 同步副本确保用户点击后立刻关页面时也不会丢失。
  writeBrowserCopy(serialized);
  return queuePreferenceWrite(() => Preferences.set({ key: STORAGE_KEY, value: serialized }));
}

export function clearQuickStudyDraft(): Promise<void> {
  // tombstone 防止 Preferences 删除尚未完成时，旧原生副本被重新恢复。
  writeBrowserCopy(JSON.stringify({ version: DRAFT_VERSION, cleared: true } satisfies ClearedDraft));
  return queuePreferenceWrite(() => Preferences.remove({ key: STORAGE_KEY }));
}
