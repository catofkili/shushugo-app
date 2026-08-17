import { parseTokenBoundaries } from "../lib/furigana-data";
import { findGrammarFormRange, type GrammarFormRange } from "../lib/grammar-form-target";
import type { GrammarPoint } from "../types/grammar";
import type { FuriganaAnnotation, TokenBoundary } from "../types/furigana";
import type { ReactNode } from "react";
import { GrammarPointPopover } from "./GrammarPointPopover";
import { TokenDictionaryPopover } from "./TokenDictionaryPopover";

const rubyRules = [
  ["名詞", "めいし"],
  ["動詞", "どうし"],
  ["形容詞", "けいようし"],
  ["副詞", "ふくし"],
  ["助詞", "じょし"],
  ["接続", "せつぞく"],
  ["普通形", "ふつうけい"],
  ["辞書形", "じしょけい"],
  ["基本形", "きほんけい"],
  ["連体形", "れんたいけい"],
  ["未然形", "みぜんけい"],
  ["連用形", "れんようけい"],
  ["終止形", "しゅうしけい"],
  ["仮定形", "かていけい"],
  ["命令形", "めいれいけい"],
  ["意向形", "いこうけい"],
  ["可能形", "かのうけい"],
  ["受身形", "うけみけい"],
  ["使役形", "しえきけい"],
  ["尊敬語", "そんけいご"],
  ["謙譲語", "けんじょうご"],
  ["丁寧語", "ていねいご"],
  ["敬語", "けいご"],
  ["漢字", "かんじ"],
  ["日本語", "にほんご"],
  ["判断", "はんだん"],
  ["疑問", "ぎもん"],
  ["条件", "じょうけん"],
  ["仮定", "かてい"],
  ["原因", "げんいん"],
  ["理由", "りゆう"],
  ["目的", "もくてき"],
  ["結果", "けっか"],
  ["状態", "じょうたい"],
  ["動作", "どうさ"],
  ["程度", "ていど"],
  ["場合", "ばあい"],
  ["時間", "じかん"],
  ["場所", "ばしょ"],
  ["方向", "ほうこう"],
  ["対象", "たいしょう"],
  ["比較", "ひかく"],
  ["例外", "れいがい"],
  ["強調", "きょうちょう"],
  ["逆接", "ぎゃくせつ"],
  ["並列", "へいれつ"],
  ["例示", "れいじ"],
  ["推量", "すいりょう"],
  ["伝聞", "でんぶん"],
  ["様子", "ようす"],
  ["否定", "ひてい"],
  ["肯定", "こうてい"],
  ["現在", "げんざい"],
  ["過去", "かこ"],
  ["禁止", "きんし"],
  ["義務", "ぎむ"],
  ["許可", "きょか"],
  ["依頼", "いらい"],
  ["命令", "めいれい"],
  ["勧誘", "かんゆう"],
  ["意志", "いし"],
  ["希望", "きぼう"],
  ["予定", "よてい"],
  ["経験", "けいけん"],
  ["必要", "ひつよう"],
  ["自動詞", "じどうし"],
  ["他動詞", "たどうし"],
  ["私", "わたし"],
  ["彼女", "かのじょ"],
  ["彼", "かれ"],
  ["人", "ひと"],
  ["学生", "がくせい"],
  ["先生", "せんせい"],
  ["会社員", "かいしゃいん"],
  ["会社", "かいしゃ"],
  ["学校", "がっこう"],
  ["去年", "きょねん"],
  ["今年", "ことし"],
  ["来年", "らいねん"],
  ["今日", "きょう"],
  ["明日", "あした"],
  ["昨日", "きのう"],
  ["毎日", "まいにち"],
  ["日本", "にほん"],
  ["東京", "とうきょう"],
  ["雨", "あめ"],
  ["手紙", "てがみ"],
  ["部屋", "へや"],
  ["子供", "こども"],
  ["試験", "しけん"],
  ["合格", "ごうかく"],
  ["勉強", "べんきょう"],
  ["料理", "りょうり"],
  ["仕事", "しごと"],
  ["電車", "でんしゃ"],
  ["車", "くるま"],
  ["本当", "ほんとう"],
  ["本", "ほん"],
  ["気持", "きも"],
  ["気分", "きぶん"],
  ["元気", "げんき"],
  ["病気", "びょうき"],
  ["友達", "ともだち"],
  ["家", "いえ"],
  ["駅", "えき"],
  ["店", "みせ"],
  ["映画", "えいが"],
  ["写真", "しゃしん"],
  ["言葉", "ことば"],
  ["意味", "いみ"],
  ["説明", "せつめい"],
  ["問題", "もんだい"],
  ["質問", "しつもん"],
  ["答", "こた"],
  ["名前", "なまえ"],
  ["毎朝", "まいあさ"],
  ["朝", "あさ"],
  ["昼", "ひる"],
  ["夜", "よる"],
  ["母", "はは"],
  ["父", "ちち"],
  ["兄", "あに"],
  ["姉", "あね"],
  ["妹", "いもうと"],
  ["弟", "おとうと"]
] as const;

const sortedRules = [...rubyRules].sort((left, right) => right[0].length - left[0].length);

const isKanjiChar = (char: string) => /[㐀-鿿々〇]/u.test(char);

/**
 * 兜底表是字面匹配，没有语境。单字规则贴在复合词中间时必然出错：
 * 祖父母 → 祖 + 父(ちち) + 母(はは)，家族 → 家(いえ)族，三人 → 三 人(ひと)。
 * 所以单字规则左右只要挨着汉字就不出注音——宁可不注，也不要注错。
 *
 * 多字规则自带边界信息（日本語、会社員），不受这条限制，否则
 * 语法标题里的 動詞/名詞 这类术语会跟着一起哑掉。
 *
 * 正常路径是烘焙好的 furigana，这张表只在没有注音数据时兜底：
 * 导入的自定义词表（word-list-import 不写 example_furigana）、
 * 例句 breakdown 词块、以及还没接上预生成注音的语法标题。
 */
const ruleFitsContext = (text: string, index: number, base: string) => {
  if (base.length > 1) return true;
  return !isKanjiChar(text[index - 1] ?? "") && !isKanjiChar(text[index + base.length] ?? "");
};

type RubyNode = string | { base: string; reading: string };

const annotatedNodes = (text: string, annotations: readonly FuriganaAnnotation[]): RubyNode[] | null => {
  const sorted = [...annotations].sort((left, right) => left.start - right.start);
  const nodes: RubyNode[] = [];
  let cursor = 0;
  for (const annotation of sorted) {
    const end = annotation.start + annotation.length;
    if (
      annotation.start < cursor
      || annotation.start < 0
      || annotation.length <= 0
      || end > text.length
      || !annotation.reading
    ) return null;
    if (annotation.start > cursor) nodes.push(text.slice(cursor, annotation.start));
    nodes.push({ base: text.slice(annotation.start, end), reading: annotation.reading });
    cursor = end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

const renderNodes = (nodes: RubyNode[]) => nodes.map((node, nodeIndex) =>
  typeof node === "string" ? (
    <span key={`${node}-${nodeIndex}`}>{node}</span>
  ) : (
    <ruby key={`${node.base}-${nodeIndex}`} className="jp-ruby">
      {node.base}
      <rt>{node.reading}</rt>
    </ruby>
  )
);

const renderTokenized = (
  text: string,
  boundaries: readonly TokenBoundary[],
  renderSlice: (slice: string, boundary: TokenBoundary, tokenIndex: number) => RubyNode[],
  readingForToken: (boundary: TokenBoundary, tokenIndex: number) => string = (boundary) => boundary.text,
  grammarTarget?: { range: GrammarFormRange; point: Pick<GrammarPoint, "title" | "meaning" | "structure" | "explanation"> }
) => {
  const rendered: ReactNode[] = [];
  let grammarNodes: ReactNode[] = [];
  const flushGrammarNodes = () => {
    if (!grammarNodes.length || !grammarTarget) return;
    rendered.push(
      <GrammarPointPopover
        key={`grammar-form-${grammarTarget.range.start}`}
        point={grammarTarget.point}
        targetText={grammarTarget.range.text}
      >
        {grammarNodes}
      </GrammarPointPopover>
    );
    grammarNodes = [];
  };
  boundaries.forEach((boundary, tokenIndex) => {
    const inGrammarTarget = Boolean(
      grammarTarget
      && boundary.start >= grammarTarget.range.start
      && boundary.end <= grammarTarget.range.end
    );
    const nodes = renderNodes(renderSlice(text.slice(boundary.start, boundary.end), boundary, tokenIndex));
    if (inGrammarTarget) {
      grammarNodes.push(...nodes);
      return;
    }
    flushGrammarNodes();
    rendered.push(
      <TokenDictionaryPopover
        key={`token-${boundary.start}`}
        boundary={boundary}
        reading={readingForToken(boundary, tokenIndex)}
      >
        {nodes}
      </TokenDictionaryPopover>
    );
  });
  flushGrammarNodes();
  return rendered;
};

const readingForBoundary = (
  text: string,
  boundary: TokenBoundary,
  annotations: readonly FuriganaAnnotation[]
) => {
  const relevant = annotations
    .filter((annotation) => (
      annotation.start >= boundary.start
      && annotation.start + annotation.length <= boundary.end
    ))
    .sort((left, right) => left.start - right.start);
  let cursor = boundary.start;
  let reading = "";
  for (const annotation of relevant) {
    if (annotation.start > cursor) reading += text.slice(cursor, annotation.start);
    reading += annotation.reading;
    cursor = annotation.start + annotation.length;
  }
  return `${reading}${text.slice(cursor, boundary.end)}`;
};

const fallbackNodes = (text: string): RubyNode[] => {
  const nodes: RubyNode[] = [];
  let index = 0;
  while (index < text.length) {
    const rule = sortedRules.find(([base]) => (
      text.startsWith(base, index) && ruleFitsContext(text, index, base)
    ));
    if (!rule) {
      nodes.push(text[index]);
      index += 1;
      continue;
    }
    nodes.push({ base: rule[0], reading: rule[1] });
    index += rule[0].length;
  }
  return nodes;
};

export const JapaneseRuby = ({
  text,
  furigana,
  tokenLengths,
  tokenLemmas,
  tokenBoundaries,
  grammarPoint
}: {
  text: string;
  furigana?: readonly FuriganaAnnotation[];
  /** Compact build-time lengths used by static grammar examples. */
  tokenLengths?: string;
  tokenLemmas?: string;
  /** Expanded lengths used by SQLite-backed word/grammar cards. */
  tokenBoundaries?: readonly TokenBoundary[];
  /** When present, matching example text opens the grammar explanation first. */
  grammarPoint?: Pick<GrammarPoint, "title" | "meaning" | "structure" | "explanation" | "connection">;
}) => {
  const precomputed = furigana?.length ? annotatedNodes(text, furigana) : null;
  const boundaries = tokenBoundaries?.length
    ? tokenBoundaries
    : parseTokenBoundaries(tokenLengths, text, tokenLemmas);
  const grammarRange = grammarPoint ? findGrammarFormRange(text, grammarPoint) : null;
  const grammarTarget = grammarPoint && grammarRange ? { range: grammarRange, point: grammarPoint } : undefined;
  if (boundaries?.length) {
    if (precomputed) {
      const annotationsByToken = boundaries.map((boundary) => (furigana ?? [])
        .filter((annotation) => (
          annotation.start >= boundary.start
          && annotation.start + annotation.length <= boundary.end
        ))
        .map((annotation) => ({ ...annotation, start: annotation.start - boundary.start })));
      const assignedAnnotations = annotationsByToken.reduce((count, annotations) => count + annotations.length, 0);
      if (assignedAnnotations === furigana?.length) {
        return <>{renderTokenized(text, boundaries, (slice, _boundary, tokenIndex) => (
          annotatedNodes(slice, annotationsByToken[tokenIndex] ?? []) ?? [slice]
        ), (boundary) => readingForBoundary(text, boundary, furigana ?? []), grammarTarget)}</>;
      }
      // 数据更新或人工覆盖造成注音跨 token 时，保留完整注音，不静默丢字。
      return <>{renderNodes(precomputed)}</>;
    }
    return <>{renderTokenized(text, boundaries, (slice) => fallbackNodes(slice), undefined, grammarTarget)}</>;
  }
  if (precomputed) return <>{renderNodes(precomputed)}</>;
  return <>{renderNodes(fallbackNodes(text))}</>;
};
