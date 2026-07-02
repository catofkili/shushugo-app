import { ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JapaneseRuby } from "./JapaneseRuby";

type Hint = {
  label: string;
  title: string;
  body: string;
  examples: string[];
};

const hints: Hint[] = [
  { label: "ない形", title: "ない形", body: "动词普通体否定形。常用来接续表示否定、义务、禁止等语法。", examples: ["書く→書かない", "食べる→食べない", "する→しない"] },
  { label: "ナイ形", title: "ない形", body: "动词普通体否定形。常用来接续表示否定、义务、禁止等语法。", examples: ["買う→買わない", "見る→見ない", "来る→来ない"] },
  { label: "た形", title: "た形", body: "动词普通体过去形。常接表示经验、之后、假定等语法。", examples: ["書く→書いた", "食べる→食べた", "する→した"] },
  { label: "タ形", title: "た形", body: "动词普通体过去形。常接表示经验、之后、假定等语法。", examples: ["行く→行った", "見る→見た", "来る→来た"] },
  { label: "て形", title: "て形", body: "动词连接形。常用于连接动作、请求、进行、原因等。", examples: ["書く→書いて", "食べる→食べて", "する→して"] },
  { label: "テ形", title: "て形", body: "动词连接形。常用于连接动作、请求、进行、原因等。", examples: ["飲む→飲んで", "見る→見て", "来る→来て"] },
  { label: "ます形", title: "ます形", body: "动词礼貌形去掉「ます」前的形，也常叫连用形。", examples: ["書きます→書き", "食べます→食べ", "します→し"] },
  { label: "マス形", title: "ます形", body: "动词礼貌形去掉「ます」前的形，也常叫连用形。", examples: ["読みます→読み", "見ます→見", "来ます→来"] },
  { label: "辞書形", title: "辞書形", body: "词典里查到的动词原形，也叫基本形。", examples: ["書く", "食べる", "する"] },
  { label: "普通形", title: "普通形", body: "非礼貌体。动词、形容词、名词/な形容词的普通说法都算普通形。", examples: ["行く／行かない", "高い／高かった", "学生だ／学生だった"] },
  { label: "基本形", title: "基本形", body: "词的基本形。动词通常等于辞書形。", examples: ["書く", "高い", "静かだ"] },
  { label: "連体形", title: "連体形", body: "修饰名词时使用的形式。现代日语里多和普通形相同。", examples: ["読む本", "静かな町", "学生の人"] },
  { label: "未然形", title: "未然形", body: "后接否定、被动、使役等助动词时使用的未然形式。", examples: ["書く→書か", "食べる→食べ", "する→し"] },
  { label: "語幹", title: "語幹", body: "去掉活用词尾后保留下来的核心部分。", examples: ["食べる→食べ", "静かだ→静か", "高い→高"] },
  { label: "名詞", title: "名詞", body: "名词。可以表示人、物、地点、事情等。", examples: ["学生", "日本語", "雨"] },
  { label: "動詞", title: "動詞", body: "动词。表示动作、变化、存在等。", examples: ["行く", "食べる", "勉強する"] },
  { label: "動ない形", title: "動詞ない形", body: "动词变成ない形后再接后面的语法。", examples: ["書かない＋で", "食べない＋こと", "しない＋ように"] },
  { label: "動た形", title: "動詞た形", body: "动词变成た形后再接后面的语法。", examples: ["読んだ＋あと", "食べた＋こと", "行った＋ら"] },
  { label: "動辞書形", title: "動詞辞書形", body: "动词原形直接接后面的语法。", examples: ["行く＋前に", "食べる＋こと", "する＋ため"] },
  { label: "動普通形", title: "動詞普通形", body: "动词用普通形接续，可包含现在/过去、肯定/否定。", examples: ["行く", "行った", "行かない"] },
  { label: "い形容詞", title: "い形容詞", body: "以い结尾并按い形容词规则活用的形容词。", examples: ["高い", "おいしい", "寒い"] },
  { label: "イ形容詞", title: "い形容詞", body: "以い结尾并按い形容词规则活用的形容词。", examples: ["安い", "新しい", "早い"] },
  { label: "な形容詞", title: "な形容詞", body: "修饰名词时通常加「な」的形容词。", examples: ["静か", "便利", "有名"] },
  { label: "ナ形容詞", title: "な形容詞", body: "修饰名词时通常加「な」的形容词。", examples: ["簡単", "親切", "大切"] },
  { label: "形容詞", title: "形容詞", body: "描述性质或状态的词。日语里常分为い形容词和な形容词。", examples: ["高い", "静か", "便利"] },
  { label: "副詞", title: "副詞", body: "修饰动词、形容词或整个句子的词。", examples: ["とても", "ゆっくり", "すぐ"] },
  { label: "助詞", title: "助詞", body: "接在词后表示关系、格、话题、方向等的小词。", examples: ["は", "が", "を"] },
  { label: "可能形", title: "可能形", body: "表示能够做某事的动词形式。", examples: ["書く→書ける", "食べる→食べられる", "する→できる"] },
  { label: "受身形", title: "受身形", body: "被动形，表示被做某事或受到影响。", examples: ["書く→書かれる", "食べる→食べられる", "する→される"] },
  { label: "使役形", title: "使役形", body: "表示让/使别人做某事。", examples: ["書く→書かせる", "食べる→食べさせる", "する→させる"] },
  { label: "命令形", title: "命令形", body: "表示命令的形式，语气较强。", examples: ["書く→書け", "食べる→食べろ", "する→しろ"] },
  { label: "意向形", title: "意向形", body: "表示意志、提议的形式。", examples: ["行く→行こう", "食べる→食べよう", "する→しよう"] }
].sort((left, right) => right.label.length - left.label.length);

const regex = new RegExp(`(${hints.map((hint) => hint.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
const hintByLabel = new Map(hints.map((hint) => [hint.label, hint]));

const HintBubble = ({ hint, children }: { hint: Hint; children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 288;
    setPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 12), window.innerWidth - width / 2 - 12),
      top: Math.min(rect.bottom + 8, window.innerHeight - 132)
    });
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        className="relative inline-flex cursor-help items-center border-b border-dotted border-[#81D8CF]"
        tabIndex={0}
      >
        {children}
      </span>
      {position && createPortal(
        <span
          className="pointer-events-none fixed z-[2147483647] w-72 rounded-2xl border border-white/15 bg-[#202424] p-3 text-left text-xs leading-5 text-white shadow-2xl"
          style={{ left: position.left, top: position.top, transform: "translateX(-50%)" }}
        >
          <span className="block text-sm font-bold text-[#81D8CF]">{hint.title}</span>
          <span className="mt-1 block text-white/78">{hint.body}</span>
          <span className="mt-2 block text-white/55">例：{hint.examples.join("／")}</span>
        </span>,
        document.body
      )}
    </>
  );
};

export const GrammarTermHint = ({ text }: { text: string }) => {
  const parts = text.split(regex).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        const hint = hintByLabel.get(part);
        return hint ? (
          <HintBubble key={`${part}-${index}`} hint={hint}>
            <JapaneseRuby text={part} />
          </HintBubble>
        ) : (
          <span key={`${part}-${index}`}>
            <JapaneseRuby text={part} />
          </span>
        );
      })}
    </>
  );
};
