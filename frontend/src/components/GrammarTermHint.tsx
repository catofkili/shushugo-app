import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openGrammarFoundation } from "../lib/grammar-foundation-navigation";
import { JapaneseRuby } from "./JapaneseRuby";
import { queryTouchRect, touchEventsEnabled } from "../lib/touch-adapter";
import { grammarHintByLabel as hintByLabel, grammarHintRegex as regex, foundationRuleByTitle, type Hint } from "./grammar-term-hint-data";

const HintBubble = ({ hint, children }: { hint: Hint; children: ReactNode }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const selectorId = `grammar-hint-${useId().replace(/:/g, "")}`;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // 手机上没有悬停：点一下把术语小卡钉住，再点一下或点别处才收起
  const [pinned, setPinned] = useState(false);
  const foundationRuleId = foundationRuleByTitle[hint.title];

  const place = (rect: { left: number; width: number; bottom: number }) => {
    if (!rect) return;
    const width = 288;
    setPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 12), window.innerWidth - width / 2 - 12),
      top: Math.min(rect.bottom + 8, window.innerHeight - 132)
    });
  };

  const show = () => {
    if (touchEventsEnabled()) {
      void queryTouchRect(`#${selectorId}`).then((rect) => { if (rect) place(rect); });
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (rect) place(rect);
  };

  const togglePin = () => {
    if (pinned) {
      setPinned(false);
      setPosition(null);
      return;
    }
    show();
    setPinned(true);
  };
  const tooltip = position && (
    <span
      className="pointer-events-none fixed z-[2147483647] w-72 rounded-2xl border border-white/15 bg-[#202424] p-3 text-left text-xs leading-5 text-white shadow-2xl"
      style={{ left: position.left, top: position.top, transform: "translateX(-50%)" }}
    >
      <span className="block text-sm font-bold text-[#81D8CF]">{hint.title}</span>
      <span className="mt-1 block text-white/78">{hint.body}</span>
      <span className="mt-2 block text-white/55">例：{hint.examples.join("／")}</span>
      {foundationRuleId && <span className="mt-2 block font-bold text-[#81D8CF]">点击术语查看完整基础规则</span>}
    </span>
  );

  // 钉住期间只有点别处才收起 —— 悬停移开／失焦都不收，否则手机上刚点出来就没了
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      setPinned(false);
      setPosition(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pinned]);

  return (
    <>
      <span
        ref={ref}
        id={selectorId}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned) setPosition(null);
        }}
        onFocus={show}
        onBlur={() => {
          if (!pinned) setPosition(null);
        }}
        onClick={(event) => {
          event.stopPropagation();
          // 有「基础规则」的术语照旧直接跳转；假名／发音术语没有链接，点了要能弹出解释
          if (foundationRuleId) {
            openGrammarFoundation(foundationRuleId);
            return;
          }
          togglePin();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (foundationRuleId) {
            openGrammarFoundation(foundationRuleId);
            return;
          }
          togglePin();
        }}
        className={`relative inline-flex items-center border-b border-dotted border-[#81D8CF] ${foundationRuleId ? "cursor-pointer" : "cursor-help"}`}
        role={foundationRuleId ? "button" : undefined}
        title={foundationRuleId ? "打开对应的基础规则" : undefined}
        tabIndex={0}
      >
        {children}
      </span>
      {tooltip && (touchEventsEnabled() ? tooltip : createPortal(tooltip, document.body))}
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
