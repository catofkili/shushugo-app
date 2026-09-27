import { useId, useState, type ReactNode } from "react";
import { Text, View } from "@tarojs/components";
import { openGrammarFoundation } from "../lib/grammar-foundation-navigation";
import { queryTouchRect } from "../lib/touch-adapter";
import { JapaneseRuby } from "./JapaneseRuby";
import { grammarHintByLabel, grammarHintRegex, foundationRuleByTitle, type Hint } from "./grammar-term-hint-data";

const HintBubble = ({ hint, children }: { hint: Hint; children: ReactNode }) => {
  const id = `grammar-hint-${useId().replace(/:/g, "")}`;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const foundationRuleId = foundationRuleByTitle[hint.title];

  const toggle = (event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
    if (foundationRuleId) {
      openGrammarFoundation(foundationRuleId);
      return;
    }
    if (position) {
      setPosition(null);
      return;
    }
    void queryTouchRect(`#${id}`).then((rect) => {
      if (!rect) return;
      const width = 288;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      setPosition({
        left: Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 12), viewportWidth - width / 2 - 12),
        top: Math.min(rect.bottom + 8, viewportHeight - 132)
      });
    });
  };

  return <>
    <View id={id} className="relative inline-flex items-center border-b border-dotted border-[#81D8CF]" onClick={toggle}>{children}</View>
    {position && <>
      <View className="fixed inset-0 z-[2147483646]" style={{ background: "transparent" }} onClick={() => setPosition(null)} />
      <View
        className="fixed z-[2147483647] w-72 rounded-2xl border border-white/15 bg-[#202424] p-3 text-left text-xs leading-5 text-white shadow-2xl"
        style={{ left: position.left, top: position.top, transform: "translateX(-50%)", pointerEvents: "none" }}
      >
        <Text className="block text-sm font-bold text-[#81D8CF]">{hint.title}</Text>
        <Text className="mt-1 block text-white/78">{hint.body}</Text>
        <Text className="mt-2 block text-white/55">例：{hint.examples.join("／")}</Text>
        {foundationRuleId && <Text className="mt-2 block font-bold text-[#81D8CF]">点击术语查看完整基础规则</Text>}
      </View>
    </>}
  </>;
};

export const GrammarTermHint = ({ text }: { text: string }) => text.split(grammarHintRegex).filter(Boolean).map((part, index) => {
  const hint = grammarHintByLabel.get(part);
  return hint
    ? <HintBubble key={`${part}-${index}`} hint={hint}><JapaneseRuby text={part} /></HintBubble>
    : <JapaneseRuby key={`${part}-${index}`} text={part} />;
});
