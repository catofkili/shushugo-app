import { ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openGrammarFoundation } from "../lib/grammar-foundation-navigation";
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
  { label: "ます形", title: "ます形", body: "以「ます」结尾的礼貌形式。接续表若写“ます形去ます”，指去掉ます后的词干。", examples: ["書きます", "食べます", "します"] },
  { label: "マス形", title: "ます形", body: "以「ます」结尾的礼貌形式。接续表若写“ます形去ます”，指去掉ます后的词干。", examples: ["読みます", "見ます", "来ます"] },
  { label: "辞書形", title: "辞書形", body: "词典里查到的动词原形，也叫基本形。", examples: ["書く", "食べる", "する"] },
  { label: "普通形", title: "普通形", body: "不使用です／ます的基本文体，不等于粗鲁。动词、形容词和名词谓语都有普通形。", examples: ["行く／行かない", "高い／高かった", "学生だ／学生だった"] },
  { label: "基本形", title: "基本形", body: "词的基本形。动词通常等于辞書形。", examples: ["書く", "高い", "静かだ"] },
  { label: "連体形", title: "連体形", body: "修饰名词时使用的形式。现代日语里多和普通形相同。", examples: ["読む本", "静かな町", "学生の人"] },
  { label: "終止形", title: "終止形", body: "在句末完成陈述的传统活用名称；现代动词通常与辞书形同形。", examples: ["手紙を書く。", "朝食を食べる。", "友達が来る。"] },
  { label: "未然形", title: "未然形", body: "接ない、ず、被动或使役等后项前使用的词形。する会按后项出现し／せ／さ。", examples: ["書く→書か", "食べる→食べ", "する→しない／せず／させる"] },
  { label: "連用形", title: "連用形", body: "连接ます、たい或其他用言的底座；五段动词还会在て／た前发生音便。", examples: ["書く→書き", "読む→読み／読ん", "食べる→食べ"] },
  { label: "仮定形", title: "仮定形", body: "传统活用术语，动词接ば时使用的底座。", examples: ["書く→書けば", "食べる→食べれば", "する→すれば"] },
  { label: "ば形", title: "ば形", body: "表示假定条件的形式。五段改え段加ば，一段去る加れば。", examples: ["書けば", "食べれば", "来れば"] },
  { label: "たら形", title: "たら形", body: "由た形加ら构成，可表示假设或前项完成之后。", examples: ["書いたら", "食べたら", "来たら"] },
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
  { label: "使役受身形", title: "使役被动形", body: "把被迫执行动作的人放到主语位置。", examples: ["書かされる", "食べさせられる", "させられる"] },
  { label: "使役被動形", title: "使役被动形", body: "把被迫执行动作的人放到主语位置。", examples: ["書かされる", "食べさせられる", "させられる"] },
  { label: "命令形", title: "命令形", body: "表示命令的形式，语气较强。", examples: ["書く→書け", "食べる→食べろ", "する→しろ"] },
  { label: "禁止形", title: "禁止形", body: "辞书形后加な，直接禁止对方做某事，语气较强。", examples: ["入るな", "食べるな", "するな"] },
  { label: "意向形", title: "意向形", body: "表示意志、提议的形式，也常叫意志形。", examples: ["行く→行こう", "食べる→食べよう", "する→しよう"] },
  { label: "意志形", title: "意志形", body: "表示意志、提议的形式，也常叫意向形。", examples: ["行く→行こう", "食べる→食べよう", "する→しよう"] },
  { label: "たい形", title: "たい形", body: "连用形接たい，表示想做；之后按い形容词变化。", examples: ["書きたい", "食べたくない", "したかった"] },
  { label: "ず形", title: "ず形", body: "未然形接ず构成书面否定；ず本身已经表示否定。", examples: ["書かず", "食べず", "せず"] },
  { label: "まい形", title: "まい形", body: "表示否定意志或否定推测的书面形式。", examples: ["行くまい", "食べるまい", "すまい"] }
].sort((left, right) => right.label.length - left.label.length);

const regex = new RegExp(`(${hints.map((hint) => hint.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
const hintByLabel = new Map(hints.map((hint) => [hint.label, hint]));

const foundationRuleByTitle: Record<string, string> = {
  "ない形": "verb-form-nai",
  "た形": "verb-form-ta",
  "て形": "verb-form-te",
  "ます形": "verb-form-masu",
  "辞書形": "verb-form-dictionary",
  "基本形": "verb-form-dictionary",
  "未然形": "verb-form-mizen",
  "連用形": "verb-form-renyo",
  "仮定形": "verb-form-ba",
  "ば形": "verb-form-ba",
  "たら形": "verb-form-tara",
  "語幹": "verb-form-renyo",
  "動詞": "verb-conjugation-system",
  "動詞ない形": "verb-form-nai",
  "動詞た形": "verb-form-ta",
  "動詞辞書形": "verb-form-dictionary",
  "動詞普通形": "verb-form-plain",
  "命令形": "verb-form-imperative",
  "禁止形": "verb-form-prohibitive",
  "意向形": "verb-form-volitional",
  "意志形": "verb-form-volitional",
  "たい形": "verb-form-tai",
  "ず形": "verb-form-literary-negative",
  "まい形": "verb-form-mai",
  "普通形": "verb-form-plain",
  "終止形": "verb-form-terminal",
  "連体形": "verb-form-attributive",
  "名詞": "inflecting-and-fixed-words",
  "い形容詞": "adjective-and-noun-conjugation",
  "な形容詞": "adjective-and-noun-conjugation",
  "形容詞": "adjective-and-noun-conjugation",
  "副詞": "inflecting-and-fixed-words",
  "助詞": "core-case-particles",
  "可能形": "verb-form-potential",
  "受身形": "verb-form-passive",
  "使役形": "verb-form-causative",
  "使役被动形": "verb-form-causative-passive"
};

const HintBubble = ({ hint, children }: { hint: Hint; children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const foundationRuleId = foundationRuleByTitle[hint.title];

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
        onClick={(event) => {
          if (!foundationRuleId) return;
          event.stopPropagation();
          openGrammarFoundation(foundationRuleId);
        }}
        onKeyDown={(event) => {
          if (foundationRuleId && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            openGrammarFoundation(foundationRuleId);
          }
        }}
        className={`relative inline-flex items-center border-b border-dotted border-[#81D8CF] ${foundationRuleId ? "cursor-pointer" : "cursor-help"}`}
        role={foundationRuleId ? "button" : undefined}
        title={foundationRuleId ? "打开对应的基础规则" : undefined}
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
          {foundationRuleId && <span className="mt-2 block font-bold text-[#81D8CF]">点击术语查看完整基础规则</span>}
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
