import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Flame, ListChecks, Star, X } from "lucide-react";
import {
  addFavorite,
  addFavorites,
  getStubbornGrammarToday,
  getStubbornHistoryDays,
  getStubbornWordsToday,
  type StubbornDay,
  type StubbornGrammarToday,
  type StubbornWordToday
} from "../../lib/api";
import { useFavoriteFolderPicker } from "../../components/FavoriteFolderPicker";
import { JapaneseRuby } from "../../components/JapaneseRuby";
import { Sticker } from "../../components/CapybaraMascot";
import { preferredWordSurface } from "../../lib/orthography";
import { getGrammarTitleFuriganaByPattern } from "../../lib/grammar-title-furigana";

/** 顽固词那一行。完成页的今日清单和历史清单共用这一份，别再写第二套行样式。 */
export const StubbornWordRow = ({
  word,
  onFavorite
}: {
  word: StubbornWordToday;
  onFavorite: (word: StubbornWordToday) => void;
}) => (
  <div className="flex items-center gap-3 border-t border-white/8 py-2 first:border-t-0">
    <div className="min-w-0 flex-1">
      <p className="jp-serif truncate text-base font-semibold text-white">{preferredWordSurface(word)}</p>
      <p className="truncate text-xs text-white/55">{word.kana} · {word.meaning}</p>
    </div>
    <span className="shrink-0 text-[11px] text-white/45">
      {word.wrongToday > 0 ? `错 ${word.wrongToday} 次` : `累计忘 ${word.lapses} 次`}
    </span>
    <button
      onClick={() => onFavorite(word)}
      disabled={word.isFavorite}
      className={`focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/15 ${word.isFavorite ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-white/6 text-white/62"}`}
      title={word.isFavorite ? "已收藏" : "收藏这个词"}
    >
      <Star size={14} fill={word.isFavorite ? "currentColor" : "none"} />
    </button>
  </div>
);

/** 顽固语法那一行。没有收藏按钮，理由见 stubborn-today.ts 里 getStubbornGrammarToday 的注释。 */
export const StubbornGrammarRow = ({ point }: { point: StubbornGrammarToday }) => (
  <div className="flex items-center gap-3 border-t border-white/8 py-2 first:border-t-0">
    <span className="shrink-0 rounded-md bg-[#E8971C]/18 px-1.5 py-0.5 text-[11px] font-bold text-[#E8971C]">
      {point.level}
    </span>
    <div className="min-w-0 flex-1">
      <p className="jp-serif truncate text-base font-semibold text-white"><JapaneseRuby text={point.pattern} furigana={getGrammarTitleFuriganaByPattern(point.pattern)} /></p>
      <p className="truncate text-xs text-white/55">{point.meaning}</p>
    </div>
    <span className="shrink-0 text-[11px] text-white/45">
      {point.wrongToday > 0 ? `错 ${point.wrongToday} 次` : `累计忘 ${point.lapses} 次`}
    </span>
  </div>
);

const weekdayOf = (date: string) => "日一二三四五六"[new Date(`${date}T12:00:00`).getDay()] ?? "";

/**
 * 「今天之前的顽固词」——按天翻回去看那天跟你打过架的词（日推历史那种翻法）。
 *
 * 判据和完成页那张今日表**完全同一条**（同一个 SQL，只是换了个日期参数），
 * 所以两处不会各说一套。⚠️ 那条判据里的「累计忘过几次」用的是 forgot_count 的
 * **当前值**，历史因此是「以今天的眼光回看那天」，见 getStubbornHistoryDays 的注释。
 *
 * 这一页也**不给评分按钮**（答案全露着时评分等于给 FSRS 灌「记住了」，
 * 和辨析气泡、词库详情同一个道理）；要真刷走「快速复习」。
 */
export const StubbornHistorySheet = ({
  onQuickStudy,
  onClose
}: {
  onQuickStudy?: (wordIds: number[]) => void;
  onClose: () => void;
}) => {
  const { pickFolder, picker } = useFavoriteFolderPicker();
  const [days] = useState<StubbornDay[]>(() => getStubbornHistoryDays());
  const [day, setDay] = useState<string | null>(null);
  const [words, setWords] = useState<StubbornWordToday[]>([]);
  const [grammar, setGrammar] = useState<StubbornGrammarToday[]>([]);

  useEffect(() => {
    if (!day) return;
    setWords(getStubbornWordsToday(day));
    setGrammar(getStubbornGrammarToday(day));
  }, [day]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // 学习页的全局快捷键挂在 window 上，同一节点上的监听只有 Immediate 版拦得住。
      event.stopImmediatePropagation();
      if (day) setDay(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [day, onClose]);

  const unfavorited = words.filter((word) => !word.isFavorite);
  const markFavorited = (picked: StubbornWordToday[]) => {
    setWords((current) => current.map((word) => (
      picked.some((item) => item.id === word.id) ? { ...word, isFavorite: true } : word
    )));
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/55 px-3 pb-3 pt-10 backdrop-blur-sm sm:items-center sm:p-6">
      <section className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#3f4343] shadow-2xl">
        <header className="flex items-center gap-2 border-b border-white/10 p-3 sm:p-4">
          {day ? (
            <button onClick={() => setDay(null)} className="focus-ring grid h-8 w-8 place-items-center rounded-xl border border-white/15 bg-white/6 text-white/70">
              <ChevronLeft size={16} />
            </button>
          ) : (
            <Flame size={16} className="shrink-0 text-[#E8971C]" />
          )}
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-white">
            {day ? `${day} 周${weekdayOf(day)}的顽固词` : "往日顽固词"}
          </p>
          <button onClick={onClose} className="focus-ring grid h-8 w-8 place-items-center rounded-xl border border-white/15 bg-white/6 text-white/70">
            <X size={16} />
          </button>
        </header>

        {day ? (
          <>
            <div className="flex flex-wrap gap-2 px-3 pt-3 sm:px-4">
              {onQuickStudy && words.length > 0 && (
                <button
                  onClick={() => onQuickStudy(words.map((word) => word.id))}
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/8 px-3 text-xs font-bold text-white/75"
                >
                  <ListChecks size={13} />
                  快速复习这 {words.length} 个
                </button>
              )}
              {unfavorited.length > 0 && (
                <button
                  onClick={() => pickFolder({
                    title: `把这天 ${unfavorited.length} 个顽固词收进`,
                    onPick: (folder) => {
                      addFavorites("word", unfavorited.map((word) => word.id), folder);
                      markFavorited(unfavorited);
                    }
                  })}
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border border-[#81D8CF]/35 bg-[#81D8CF]/14 px-3 text-xs font-bold text-[#81D8CF]"
                >
                  <Star size={13} />
                  全部收藏
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {words.map((word) => (
                <StubbornWordRow
                  key={word.id}
                  word={word}
                  onFavorite={(picked) => pickFolder({
                    title: `收藏「${preferredWordSurface(picked)}」到`,
                    onPick: (folder) => {
                      addFavorite("word", picked.id, folder);
                      markFavorited([picked]);
                    }
                  })}
                />
              ))}
              {grammar.map((point) => <StubbornGrammarRow key={`g-${point.id}`} point={point} />)}
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {days.length === 0 && (
              <p className="py-6 text-center text-xs text-white/45"><Sticker name="empty-box" size={72} className="mx-auto mb-2" />还没有更早的顽固词记录。</p>
            )}
            {days.map((item) => (
              <button
                key={item.date}
                onClick={() => setDay(item.date)}
                className="focus-ring flex w-full items-center gap-3 border-t border-white/8 py-2.5 text-left first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{item.date} 周{weekdayOf(item.date)}</p>
                  <p className="truncate text-xs text-white/50">
                    {item.words > 0 ? `${item.words} 个词` : ""}
                    {item.words > 0 && item.grammar > 0 ? " · " : ""}
                    {item.grammar > 0 ? `${item.grammar} 条语法` : ""}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-white/35" />
              </button>
            ))}
          </div>
        )}
        <p className="border-t border-white/10 px-3 py-2 text-[11px] text-white/40 sm:px-4">
          忘过 8 次以上、当天又错 3 次的词
        </p>
      </section>
      {picker}
    </div>,
    document.body
  );
};
