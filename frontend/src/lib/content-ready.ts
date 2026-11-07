import type { Page, StudyMode } from "../types/app";
import { loadKanjiUnitIndex } from "./kanji-unit-index";
import { loadKanjiReadingUsage } from "./kanji-reading-usage";
import { loadKanjiReadings } from "./furigana";
import { loadPitchAccent } from "./pitch-accent";

/** 数字只依赖索引和辨析资格，不加载题面、音高或语法正文。小程序替身声明对应分包。 */
export async function readyForHomeMode(mode: StudyMode): Promise<void> {
  if (mode === "mixed") await Promise.all([loadKanjiUnitIndex(), loadKanjiReadingUsage()]);
  else if (mode === "kanji") await loadKanjiUnitIndex();
}

/** 页面挂载前等待；首页空闲时可提前调用，学习交互只读已经就绪的本地内容。 */
export async function readyForRoute(page: Page, mode: StudyMode = "classic"): Promise<void> {
  if (page === "home") return readyForHomeMode(mode);
  if (["word", "quick-study", "vocab-test", "confusion", "distinction-quiz"].includes(page)) {
    await Promise.all([loadKanjiReadings(), loadPitchAccent(), page === "word" ? readyForHomeMode(mode) : undefined]);
  } else if (page === "kanji-readings") await Promise.all([loadKanjiReadings(), loadKanjiReadingUsage(), loadKanjiUnitIndex()]);
  else if (["grammar", "detail", "grammar-foundation", "favorites"].includes(page)) await loadKanjiReadings();
  else if (["jlpt-plan", "settings"].includes(page)) await readyForHomeMode("mixed");
}
