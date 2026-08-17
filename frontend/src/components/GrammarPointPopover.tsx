import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GrammarPoint } from "../types/grammar";

export const GrammarPointPopover = ({ point, targetText, children }: {
  point: Pick<GrammarPoint, "title" | "meaning" | "structure" | "explanation">;
  targetText: string;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const toggle = (event?: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => {
    event?.stopPropagation();
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".grammar-point-sheet")) return;
      close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const popup = open && typeof document !== "undefined" ? createPortal(
    <>
      <div className="token-dictionary-backdrop" aria-hidden="true" />
      <div
        className="token-dictionary-sheet grammar-point-sheet"
        role="dialog"
        aria-label={`${point.title} 语法解释`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="token-dictionary-sheet-grabber" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="jp text-xl font-bold leading-7">{targetText}</p>
            <p className="mt-1 text-xs font-bold tracking-wide text-[#6FA83E] dark:text-[#81D8CF]">{point.title}</p>
          </div>
          <button type="button" className="token-dictionary-close" onClick={close} aria-label="关闭语法解释">×</button>
        </div>
        <p className="mt-3 text-sm font-semibold leading-6">{point.meaning}</p>
        <div className="token-dictionary-conjugation mt-3 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-65">接续</p>
          <p className="jp mt-1 text-sm font-semibold">{point.structure}</p>
          <p className="mt-2 text-xs leading-5 opacity-80">{point.explanation}</p>
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <>
      <span
        className={`grammar-form-target${open ? " grammar-form-target-open" : ""}`}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="点击查看语法解释"
        onClick={(event) => toggle(event)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle(event);
        }}
      >
        {children}
      </span>
      {popup}
    </>
  );
};
