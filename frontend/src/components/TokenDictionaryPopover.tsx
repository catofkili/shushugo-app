import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lookupTokenEntries, type TokenDictionaryEntry } from "../lib/token-dictionary";
import { describeConjugation, type ConjugationExplanation } from "../lib/conjugation-explanation";
import { addWordToTodayEncore } from "../lib/word-api";
import { playPronunciation } from "../lib/speech";
import type { TokenBoundary } from "../types/furigana";
import { displayForm } from "../lib/confusion-groups";

interface TokenDictionaryPopoverProps {
  boundary: TokenBoundary;
  reading: string;
  children: ReactNode;
}

const isWordLike = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);

const EntryDetails = ({
  entry,
  conjugation,
  surface
}: {
  entry: TokenDictionaryEntry;
  conjugation: ConjugationExplanation | null;
  surface: string;
}) => (
  <>
    <div className="token-dictionary-heading">
      <div className="min-w-0">
        {/* 外来語行的 kanji 存的是词源(camera / apartment house)，摆在标题位等于把
            日语词典写成英语词典 —— 假名永远是主词形。口径同 confusion-groups 的 displayForm。 */}
        <p className="jp text-xl font-bold leading-7">{displayForm(entry)}</p>
        {entry.kana && entry.kana !== displayForm(entry) && <p className="jp text-sm font-semibold text-[#6FA83E] dark:text-[#81D8CF]">{entry.kana}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b756f] dark:text-white/55">
        {entry.source === "supplement" && <span>补充词典</span>}
        {entry.jlptLevel && <span>{entry.jlptLevel}</span>}
        {entry.pos && <span>{entry.pos}</span>}
      </div>
    </div>
    <p className="mt-2 text-sm font-semibold leading-6">{entry.meaning || "暂无释义"}</p>
    {entry.usageNote && (
      <div className="token-dictionary-conjugation mt-3 rounded-xl p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-65">用法提示</p>
        <p className="mt-1 text-xs leading-5 opacity-85">{entry.usageNote}</p>
      </div>
    )}
    {conjugation && (
      <div className="token-dictionary-conjugation mt-3 rounded-xl p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-65">这个词形</p>
        <p className="mt-1 text-sm font-bold">{conjugation.label}</p>
        {conjugation.steps?.length ? (
          <ol className="mt-2 space-y-2 text-xs leading-5">
            {conjugation.steps.map((step, index) => (
              <li key={`${step.label}-${step.to}-${index}`}>
                <p className="jp font-semibold opacity-85">{step.from} → {step.to}</p>
                <p className="font-semibold">{step.label}</p>
                <p className="opacity-80">{step.note}</p>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <p className="jp mt-1 text-xs font-semibold opacity-75">原形：{entry.matchedForm || entry.kanji || entry.kana} → 当前：{surface}</p>
            <p className="mt-1 text-xs leading-5 opacity-80">{conjugation.rule}</p>
          </>
        )}
      </div>
    )}
    {entry.exampleJp && (
      <div className="token-dictionary-example mt-3 rounded-xl p-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6b756f] dark:text-white/55">例句</p>
        <p className="jp mt-1 text-sm font-semibold leading-6">{entry.exampleJp}</p>
        {entry.exampleMeaning && <p className="mt-1 text-xs leading-5 opacity-75">{entry.exampleMeaning}</p>}
      </div>
    )}
  </>
);

export const TokenDictionaryPopover = ({ boundary, reading, children }: TokenDictionaryPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TokenDictionaryEntry[]>([]);
  const [added, setAdded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const close = () => setOpen(false);
  const lookupText = boundary.lemma || boundary.text;

  const openDictionary = () => {
    const found = lookupTokenEntries(boundary.text, reading, 4, boundary.lemma, boundary.morphs);
    if (!found.length) {
      // Unknown residuals are not dictionary words.  Disable the block after
      // the first exact miss so it cannot repeatedly open an empty answer.
      setUnavailable(true);
      setEntries([]);
      setOpen(true);
      return;
    }
    setEntries(found);
    setOpen(true);
  };

  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (!boundary.clickable || !isWordLike(boundary.text)) return;
    if (open) close();
    else openDictionary();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (!boundary.clickable || !isWordLike(boundary.text)) return;
    if (open) close();
    else openDictionary();
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".token-dictionary-sheet")) return;
      close();
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const entry = entries[0];
  const conjugation = entry ? describeConjugation({
    surface: boundary.text,
    lemma: boundary.lemma || boundary.text,
    dictionaryForm: entry.matchedForm || entry.kanji || entry.kana,
    verbType: entry.verbType,
    pos: entry.pos,
    morphs: boundary.morphs,
    reading,
    dictionaryReading: entry.kana
  }) : null;
  const popup = open && typeof document !== "undefined" ? createPortal(
    <>
      <div className="token-dictionary-backdrop" aria-hidden="true" />
        <div
        className="token-dictionary-sheet"
        role="dialog"
        aria-label={`${lookupText} 词典解释`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="token-dictionary-sheet-grabber" />
        <div className="flex items-start justify-between gap-3">
          {entry ? <div className="min-w-0 flex-1"><EntryDetails entry={entry} conjugation={conjugation} surface={boundary.text} /></div> : (
            <div className="min-w-0">
              <p className="jp text-xl font-bold leading-7">{boundary.text}</p>
              {reading && reading !== boundary.text && <p className="jp text-sm font-semibold text-[#6FA83E] dark:text-[#81D8CF]">{reading}</p>}
              {boundary.lemma && boundary.lemma !== boundary.text && (
                <p className="mt-1 text-xs font-semibold leading-5 opacity-75">推测原形：{boundary.lemma}（词典未收录）</p>
              )}
              <p className="mt-2 text-sm font-semibold leading-6">词典中暂未收录这个词。</p>
              <p className="mt-1 text-xs leading-5 opacity-70">这个词块暂时没有可用释义。</p>
            </div>
          )}
          <button type="button" className="token-dictionary-close" onClick={close} aria-label="关闭词典解释">×</button>
        </div>
        {entry && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="token-dictionary-audio" onClick={() => void playPronunciation(entry.kanji || entry.kana, entry.kana)}>
              🔊 播放读音
            </button>
            {entry.studyWordId !== null && (
              <button
                type="button"
                className="token-dictionary-add"
                disabled={added}
                onClick={() => {
                  const didAdd = addWordToTodayEncore(entry.studyWordId as number);
                  setAdded(didAdd || added);
                }}
              >
                {added ? "已加入今日学习" : "加入学习"}
              </button>
            )}
          </div>
        )}
        {entries.length > 1 && (
          <p className="mt-2 text-[11px] font-semibold opacity-65">另有 {entries.length - 1} 条同形词，可在词典搜索中查看。</p>
        )}
      </div>
    </>,
    document.body
  ) : null;

  const interactive = boundary.clickable && !unavailable && isWordLike(boundary.text);
  return (
    <>
      <span
        className={`jp-token${open ? " jp-token-open" : ""}`}
        data-jp-token={boundary.text}
        data-jp-token-start={boundary.start}
        data-jp-token-end={boundary.end}
        data-jp-token-clickable={boundary.clickable ? "true" : "false"}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-haspopup={interactive ? "dialog" : undefined}
        aria-expanded={interactive ? open : undefined}
        title={interactive ? "点击查看词典解释" : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
      {popup}
    </>
  );
};
