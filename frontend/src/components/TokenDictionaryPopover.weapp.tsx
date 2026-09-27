import { useState, type ReactNode } from "react";
import { Text, View } from "@tarojs/components";
import { ScrollArea } from "./ScrollArea";
import { lookupTokenEntries, type TokenDictionaryEntry } from "../lib/token-dictionary";
import { describeConjugation, type ConjugationExplanation } from "../lib/conjugation-explanation";
import { addWordToTodayEncore } from "../lib/word-api";
import { playPronunciation } from "../lib/speech";
import { displayForm } from "../lib/confusion-groups";
import type { TokenBoundary, TokenMorph } from "../types/furigana";

const textValue = (value: unknown) => typeof value === "string" ? value : "";
const isWordLike = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
const safeMorphs = (morphs: TokenMorph[] | undefined): TokenMorph[] => (morphs ?? [])
  .filter((morph): morph is TokenMorph => Boolean(morph && typeof morph === "object"))
  .map((morph) => ({
    surface: textValue(morph.surface),
    lemma: textValue(morph.lemma),
    reading: textValue(morph.reading),
    pos: textValue(morph.pos),
    detail: textValue(morph.detail),
    conjugatedType: textValue(morph.conjugatedType),
    conjugatedForm: textValue(morph.conjugatedForm)
  }));

/** Native sheet for the web popover: replace createPortal/document listeners with fixed Views. */
export const TokenDictionaryPopover = ({
  boundary,
  reading,
  children
}: {
  boundary: TokenBoundary;
  reading: string;
  children: ReactNode;
}) => {
  const [entry, setEntry] = useState<TokenDictionaryEntry | null>(null);
  const [conjugation, setConjugation] = useState<ConjugationExplanation | null>(null);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const close = () => setOpen(false);

  const openDictionary = () => {
    if (!boundary.clickable || !isWordLike(boundary.text)) return;
    const match = lookupTokenEntries(boundary.text, reading, 4, boundary.lemma, safeMorphs(boundary.morphs))[0] ?? null;
    setEntry(match);
    setAdded(false);
    try {
      setConjugation(match ? describeConjugation({
        surface: boundary.text,
        lemma: boundary.lemma || boundary.text,
        dictionaryForm: match.matchedForm || match.kanji || match.kana,
        verbType: match.verbType,
        pos: match.pos,
        morphs: safeMorphs(boundary.morphs),
        reading,
        dictionaryReading: match.kana
      }) : null);
    } catch {
      setConjugation(null);
    }
    setOpen(true);
  };

  return <>
    <View className={`jp-token jp-token-weapp${open ? " jp-token-open" : ""}`} onClick={openDictionary}>{children}</View>
    {open && <>
      <View className="token-dictionary-backdrop" onClick={close} />
      <ScrollArea className="token-dictionary-sheet" onClick={(event) => event.stopPropagation()} catchMove>
        <View className="token-dictionary-sheet-grabber" />
        <View className="token-dictionary-heading">
          <View className="min-w-0">
            {entry ? <>
              <Text className="jp text-xl font-bold leading-7">{displayForm(entry)}</Text>
              {entry.kana && entry.kana !== displayForm(entry) && <Text className="jp block text-sm font-semibold text-[#6FA83E]">{entry.kana}</Text>}
            </> : <>
              <Text className="jp block text-xl font-bold leading-7">{boundary.text}</Text>
              {reading && reading !== boundary.text && <Text className="jp block text-sm font-semibold text-[#6FA83E]">{reading}</Text>}
              {boundary.lemma && boundary.lemma !== boundary.text && <Text className="mt-1 block text-xs font-semibold leading-5 opacity-75">推测原形：{boundary.lemma}（词典未收录）</Text>}
              <Text className="mt-2 block text-sm font-semibold leading-6">词典中暂未收录这个词。</Text>
              <Text className="mt-1 block text-xs leading-5 opacity-70">这个词块暂时没有可用释义。</Text>
            </>}
          </View>
          <View className="flex shrink-0 flex-wrap justify-end gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b756f]">
            {entry?.source === "supplement" && <Text>补充词典</Text>}
            {entry?.jlptLevel && <Text>{entry.jlptLevel}</Text>}
            {entry?.pos && <Text>{entry.pos}</Text>}
            <Text className="token-dictionary-close" onClick={close}>×</Text>
          </View>
        </View>
        {entry && <>
          <Text className="mt-2 block text-sm font-semibold leading-6">{entry.meaning || "暂无释义"}</Text>
          {entry.usageNote && <View className="token-dictionary-conjugation mt-3 rounded-xl p-3">
            <Text className="block text-[11px] font-bold uppercase tracking-[0.14em] opacity-65">用法提示</Text>
            <Text className="mt-1 block text-xs leading-5 opacity-85">{entry.usageNote}</Text>
          </View>}
          {conjugation && <View className="token-dictionary-conjugation mt-3 rounded-xl p-3">
            <Text className="block text-[11px] font-bold uppercase tracking-[0.14em] opacity-65">这个词形</Text>
            <Text className="mt-1 block text-sm font-bold">{conjugation.label}</Text>
            {conjugation.steps?.length ? conjugation.steps.map((step, index) => <View key={`${step.label}-${index}`} className="mt-2">
              <Text className="jp block text-xs font-semibold opacity-85">{step.from} → {step.to}</Text>
              <Text className="block text-xs font-semibold">{step.label}</Text>
              <Text className="block text-xs leading-5 opacity-80">{step.note}</Text>
            </View>) : <>
              <Text className="jp mt-1 block text-xs font-semibold opacity-75">原形：{entry.matchedForm || entry.kanji || entry.kana} → 当前：{boundary.text}</Text>
              <Text className="mt-1 block text-xs leading-5 opacity-80">{conjugation.rule}</Text>
            </>}
          </View>}
          {entry.exampleJp && <View className="token-dictionary-example mt-3 rounded-xl p-3">
            <Text className="block text-[11px] font-bold uppercase tracking-[0.14em] text-[#6b756f]">例句</Text>
            <Text className="jp mt-1 block text-sm font-semibold leading-6">{entry.exampleJp}</Text>
            {entry.exampleMeaning && <Text className="mt-1 block text-xs leading-5 opacity-75">{entry.exampleMeaning}</Text>}
          </View>}
          <View className="mt-4 flex flex-wrap gap-2">
            <Text className="token-dictionary-audio" onClick={() => void playPronunciation(entry.kanji || entry.kana, entry.kana)}>播放读音</Text>
            {entry.studyWordId !== null && <Text className="token-dictionary-add" onClick={() => setAdded(addWordToTodayEncore(entry.studyWordId as number) || added)}>
              {added ? "已加入今日学习" : "加入学习"}
            </Text>}
          </View>
          {lookupTokenEntries(boundary.text, reading, 4, boundary.lemma, safeMorphs(boundary.morphs)).length > 1 && <Text className="mt-2 block text-[11px] font-semibold opacity-65">另有多条同形词，可在词典搜索中查看。</Text>}
        </>}
      </ScrollArea>
    </>}
  </>;
};
