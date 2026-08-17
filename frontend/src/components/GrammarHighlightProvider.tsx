import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  addGrammarHighlight,
  clearStaleGrammarHighlights,
  findGrammarHighlightsInRange,
  getGrammarHighlightState,
  GRAMMAR_HIGHLIGHTS_UPDATED_EVENT,
  invalidateGrammarHighlightCache,
  removeGrammarHighlightsInRange,
  type GrammarHighlight
} from "../lib/grammarHighlights";
import { PERSISTENCE_ERROR_EVENT } from "../lib/storage";

type SelectionDraft = Omit<GrammarHighlight, "text" | "datasetVersion"> & {
  text: string;
  left: number;
  top: number;
  highlighted: boolean;
};
type HighlightRegistryLike = {
  set: (name: string, value: object) => void;
  delete: (name: string) => void;
};
type HighlightConstructor = new (...ranges: Range[]) => object;

const HIGHLIGHT_NAME = "grammar-highlight";
const normalizeHighlightText = (value: string) => value.replace(/\s+/gu, "");

const elementFromNode = (node: Node): Element | null => {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
};

const blockFromNode = (node: Node): HTMLElement | null => (
  elementFromNode(node)?.closest<HTMLElement>("[data-grammar-highlight-block]") ?? null
);

const isRubyReadingNode = (node: Node): boolean => {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest("rt"));
};

/**
 * Ruby readings are presentation only.  They are part of DOM textContent,
 * but not part of the text users select or the offsets we persist.
 */
export const visibleTextContent = (root: Node): string => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let result = "";
  let current: Node | null = walker.nextNode();
  while (current) {
    if (!isRubyReadingNode(current)) result += current.textContent ?? "";
    current = walker.nextNode();
  }
  return result;
};

const offsetInBlock = (block: HTMLElement, container: Node, offset: number) => {
  if (container.nodeType === Node.TEXT_NODE && !isRubyReadingNode(container)) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let total = 0;
    let current: Node | null = walker.nextNode();
    while (current) {
      if (!isRubyReadingNode(current)) {
        if (current === container) return total + Math.min(offset, current.textContent?.length ?? 0);
        total += current.textContent?.length ?? 0;
      }
      current = walker.nextNode();
    }
  }
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(container, offset);
  return visibleTextContent(before.cloneContents()).length;
};

const boundaryAtOffset = (block: HTMLElement, target: number): [Node, number] | null => {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let remaining = target;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (isRubyReadingNode(current)) {
      current = walker.nextNode();
      continue;
    }
    const length = current.textContent?.length ?? 0;
    if (remaining <= length) return [current, remaining];
    remaining -= length;
    current = walker.nextNode();
  }
  return null;
};

const supportsCustomHighlight = (): HighlightRegistryLike | null => {
  const css = (globalThis as typeof globalThis & {
    CSS?: { highlights?: HighlightRegistryLike };
  }).CSS;
  const HighlightClass = (globalThis as typeof globalThis & {
    Highlight?: HighlightConstructor;
  }).Highlight;
  return css?.highlights && HighlightClass ? css.highlights : null;
};

const highlightConstructor = (): HighlightConstructor | null => (
  (globalThis as typeof globalThis & { Highlight?: HighlightConstructor }).Highlight ?? null
);

const blockKey = (grammarId: string, block: string) => `${grammarId}\u001f${block}`;

const applyHighlights = (surface: HTMLElement, items: GrammarHighlight[]) => {
  const registry = supportsCustomHighlight();
  if (!registry) return;
  registry.delete(HIGHLIGHT_NAME);
  const HighlightClass = highlightConstructor();
  if (!HighlightClass) return;

  // 一个 Library 页面可能同时有几十张卡；先按精确块建索引，避免每条重点
  // 都再次扫完整个 DOM。
  const blocksByKey = new Map<string, HTMLElement[]>();
  Array.from(surface.querySelectorAll<HTMLElement>("[data-grammar-highlight-block]")).forEach((block) => {
    const grammarId = block.dataset.grammarPointId;
    const blockName = block.dataset.grammarHighlightBlock;
    if (!grammarId || !blockName) return;
    const key = blockKey(grammarId, blockName);
    const blocks = blocksByKey.get(key) ?? [];
    blocks.push(block);
    blocksByKey.set(key, blocks);
  });

  const ranges: Range[] = [];
  items.forEach((item) => {
    const blocks = blocksByKey.get(blockKey(item.grammarId, item.block)) ?? [];
    blocks.forEach((block) => {
      const blockTextLength = visibleTextContent(block).length;
      if (item.end > blockTextLength) return;
      const start = boundaryAtOffset(block, item.start);
      const end = boundaryAtOffset(block, item.end);
      if (!start || !end) return;
      const range = document.createRange();
      range.setStart(start[0], start[1]);
      range.setEnd(end[0], end[1]);
      // 内容改写后同一偏移可能仍在合法范围内；文本校验阻止它误标另一段内容。
      if (normalizeHighlightText(visibleTextContent(range.cloneContents())) !== normalizeHighlightText(item.text)) return;
      ranges.push(range);
    });
  });
  if (ranges.length) registry.set(HIGHLIGHT_NAME, new HighlightClass(...ranges));
};

const menuPosition = (rect: DOMRect) => {
  const left = Math.min(Math.max(rect.left + rect.width / 2, 68), window.innerWidth - 68);
  const top = rect.top >= 58 ? rect.top - 48 : rect.bottom + 8;
  return { left, top: Math.max(8, top) };
};

const feedbackForWriteFailure = (reason: "invalid" | "limit" | "storage") => {
  if (reason === "limit") return "划重点已达到 500 条上限，请先取消不用的重点。";
  if (reason === "storage") return "划重点暂时无法保存，请稍后重试。";
  return "这段文字无法保存为划重点。";
};

export const GrammarHighlightProvider = ({ children }: { children: ReactNode }) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<SelectionDraft | null>(null);
  const [staleCount, setStaleCount] = useState(0);
  const [feedback, setFeedback] = useState("");
  const customHighlightSupported = Boolean(supportsCustomHighlight());

  useEffect(() => {
    if (!customHighlightSupported) return undefined;
    const updateSelectionMenu = () => {
      const surface = surfaceRef.current;
      const selection = window.getSelection();
      if (!surface || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setMenu(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!surface.contains(range.commonAncestorContainer)) {
        setMenu(null);
        return;
      }
      const startBlock = blockFromNode(range.startContainer);
      const endBlock = blockFromNode(range.endContainer);
      if (!startBlock || startBlock !== endBlock) {
        setMenu(null);
        return;
      }
      const grammarId = startBlock.dataset.grammarPointId;
      const block = startBlock.dataset.grammarHighlightBlock;
      if (!grammarId || !block) {
        setMenu(null);
        return;
      }
      if (isRubyReadingNode(range.startContainer) || isRubyReadingNode(range.endContainer)) {
        setMenu(null);
        return;
      }
      const start = offsetInBlock(startBlock, range.startContainer, range.startOffset);
      const end = offsetInBlock(startBlock, range.endContainer, range.endOffset);
      const text = visibleTextContent(range.cloneContents());
      if (end <= start || !text.trim()) {
        setMenu(null);
        return;
      }
      const existing = findGrammarHighlightsInRange({ grammarId, block, start, end });
      const position = menuPosition(range.getBoundingClientRect());
      setMenu({ grammarId, block, start, end, text, highlighted: existing.length > 0, ...position });
    };

    document.addEventListener("selectionchange", updateSelectionMenu);
    window.addEventListener("scroll", updateSelectionMenu, true);
    return () => {
      document.removeEventListener("selectionchange", updateSelectionMenu);
      window.removeEventListener("scroll", updateSelectionMenu, true);
    };
  }, [customHighlightSupported]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !customHighlightSupported) return undefined;
    let frame: number | undefined;
    const refresh = () => {
      const state = getGrammarHighlightState();
      setStaleCount(state.staleCount);
      applyHighlights(surface, state.highlights);
    };
    const scheduleRefresh = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        refresh();
      });
    };
    refresh();
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleRefresh);
    observer?.observe(surface, { childList: true, subtree: true });
    const handleUpdated = () => {
      invalidateGrammarHighlightCache();
      scheduleRefresh();
    };
    window.addEventListener(GRAMMAR_HIGHLIGHTS_UPDATED_EVENT, handleUpdated);
    return () => {
      observer?.disconnect();
      window.removeEventListener(GRAMMAR_HIGHLIGHTS_UPDATED_EVENT, handleUpdated);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      supportsCustomHighlight()?.delete(HIGHLIGHT_NAME);
    };
  }, [customHighlightSupported]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 2800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    const showPersistenceError = () => setFeedback("本地学习数据暂时无法保存，请检查存储空间后重试。");
    window.addEventListener(PERSISTENCE_ERROR_EVENT, showPersistenceError);
    return () => window.removeEventListener(PERSISTENCE_ERROR_EVENT, showPersistenceError);
  }, []);

  const markSelection = () => {
    if (!menu || !customHighlightSupported) return;
    const range = {
      grammarId: menu.grammarId,
      block: menu.block,
      start: menu.start,
      end: menu.end,
      text: menu.text
    };
    const result = menu.highlighted ? removeGrammarHighlightsInRange(range) : addGrammarHighlight(range);
    if (!result.ok) {
      setFeedback(feedbackForWriteFailure(result.reason));
      return;
    }
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  };

  const clearStale = () => {
    const removed = clearStaleGrammarHighlights();
    if (removed > 0) setStaleCount(0);
  };

  return (
    <div ref={surfaceRef} data-grammar-highlight-surface className="contents">
      {children}
      {menu && (
        <div
          className="grammar-highlight-bubble"
          style={{ left: menu.left, top: menu.top }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={markSelection} aria-label={menu.highlighted ? "取消这段划重点" : "给选中文字划重点"}>
            {menu.highlighted ? "取消划重点" : "划重点"}
          </button>
        </div>
      )}
      {staleCount > 0 && (
        <div className="grammar-highlight-stale-notice" role="status">
          <span>数据已更新，{staleCount} 条划重点已失效</span>
          <button type="button" onClick={clearStale}>清除</button>
        </div>
      )}
      {feedback && <div className="grammar-highlight-feedback" role="alert">{feedback}</div>}
    </div>
  );
};
