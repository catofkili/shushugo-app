import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cursor: 0, mounted: false, values: [] as unknown[], effects: [] as (() => unknown)[],
  save: vi.fn(), replan: vi.fn()
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = h.cursor++;
    if (!(slot in h.values)) h.values[slot] = initial;
    return [h.values[slot], (next: unknown) => {
      h.values[slot] = typeof next === "function" ? next(h.values[slot]) : next;
    }];
  },
  useRef: (initial: unknown) => h.values[h.cursor++] ??= { current: initial },
  useEffect: (effect: () => unknown) => { if (!h.mounted) h.effects.push(effect); }
}));
vi.mock("../lib/daily-plan", () => ({
  PLAN_KINDS: ["words", "grammar", "kanji", "confusion"],
  PLAN_LABELS: { words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析" },
  SECONDS_PER_CARD: { words: 12, grammar: 25, kanji: 10, confusion: 40 },
  dailyPlanView: () => ({
    daysLeft: 26, wordExtras: 4,
    segments: ["words", "grammar", "kanji", "confusion"].map(kind => ({
      kind, label: kind, fresh: 25, review: kind === "words" ? 600 : 10,
      pool: { unseen: 100, due: 2000 }, suggest: { fresh: 25, review: 2000 }
    }))
  }),
  saveDailyPlan: h.save, arrangedPlan: vi.fn(), hasPendingPlanTotal: () => false
}));
vi.mock("../lib/api", () => ({ refreshTodayWordPlan: h.replan }));
vi.mock("../lib/mixed-cards", () => ({ refreshMixedCardTasks: vi.fn() }));
vi.mock("../lib/database", () => ({ getDatabase: vi.fn() }));
vi.mock("../lib/progress-events", () => ({ notifyProgressUpdated: vi.fn() }));
vi.mock("../lib/use-progress-updates", () => ({ useProgressUpdates: vi.fn() }));
vi.mock("../hooks/useEntitlements", () => ({ useEntitlements: () => ({ isPro: true }) }));
vi.mock("./DailyPlanRing", () => ({ DailyPlanRing: () => null }));
import { DailyPlanPanel } from "./DailyPlanPanel";
import { DailyPlanRing } from "./DailyPlanRing";
import { DailyPlanSlider } from "./DailyPlanSlider";
// 只替换 Taro 原生控件，执行真实 adapter；不把平台专用类型引入网页 tsc。
const nativeSource = readFileSync(new URL("./DailyPlanSlider.weapp.tsx", import.meta.url), "utf8").replace('import { Slider } from "@tarojs/components";', "");
const nativeModule: { DailyPlanSlider?: (props: unknown) => ReactElement<any> } = {};
new Function("exports", "React", "Slider", ts.transpileModule(nativeSource, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS }
}).outputText)(nativeModule, { createElement }, "slider");

const render = () => {
  h.cursor = 0;
  const tree = DailyPlanPanel({});
  h.mounted = true;
  h.effects.splice(0).forEach(effect => effect());
  return tree;
};
const find = (node: ReactNode, type: unknown): ReactElement<any> => {
  let match: ReactElement<any> | undefined;
  const visit = (child: ReactNode) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === type) match = child;
    Children.forEach(child.props.children, visit);
  };
  visit(node);
  if (!match) throw new Error("missing control");
  return match;
};
beforeEach(() => {
  Object.assign(h, { cursor: 0, mounted: false, values: [], effects: [] });
  vi.clearAllMocks();
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  render();
});

describe("新学滑杆只改新学", () => {
  it.each(["words", "grammar", "kanji", "confusion"])("%s 降为 0 不增加复习；拖动不写盘，松手只存一次", kind => {
    find(render(), DailyPlanRing).props.onFocus(kind);
    const slider = find(render(), DailyPlanSlider);
    expect(slider.props.max).toBeLessThanOrEqual(50);
    slider.props.onChange(0);
    expect(h.save).not.toHaveBeenCalled();
    // 小程序结束事件里 Changing + Change/Commit 同 tick，React 尚未重渲染。
    slider.props.onCommit();
    slider.props.onCommit();
    expect(h.save).toHaveBeenCalledTimes(1);
    const plan = h.save.mock.calls[0][0];
    expect(plan[kind]).toEqual({ fresh: 0, review: kind === "words" ? 600 : 10 });
    expect(h.replan).toHaveBeenCalledTimes(1);
    expect(find(render(), DailyPlanSlider).props.value).toBe(0);
  });

  it("小程序最后一帧数值先预览再提交，不丢失松手时的 0", () => {
    find(render(), DailyPlanRing).props.onFocus("words");
    const slider = find(render(), DailyPlanSlider);
    const native = nativeModule.DailyPlanSlider!(slider.props);
    native.props.onChanging({ detail: { value: 12 } });
    native.props.onChange({ detail: { value: 0 } });
    expect(h.save.mock.calls[0][0].words).toEqual({ fresh: 0, review: 600 });
  });
});
