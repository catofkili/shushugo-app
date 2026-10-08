import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SpellingSettings } from "./SpellingSettings";
import { DEFAULT_SPELLING_PREFS } from "../../lib/spelling/prefs";

vi.mock("../../lib/spelling", async () => {
  const prefs = await import("../../lib/spelling/prefs");
  return { ...prefs };
});

describe("设置面板", () => {
  it("默认插播关闭，至少一个题面，控件全用按钮而非表单控件", () => {
    const html = renderToStaticMarkup(<SpellingSettings prefs={{ ...DEFAULT_SPELLING_PREFS }} onChange={() => {}} onClose={() => {}} />);
    expect(html).not.toMatch(/<input|<dialog/); expect(html).toContain('aria-pressed="true" disabled=""');
    expect(html).not.toContain("选择方式"); expect(html).not.toContain("插播上限");
    expect(html).toContain('aria-pressed="false">每个词当天最后一次见到时拼一次');
  });
  it("多题面与开启插播才显示各自选项", () => {
    const html = renderToStaticMarkup(<SpellingSettings prefs={{ ...DEFAULT_SPELLING_PREFS, modes: ["meaning", "audio"], inlineAfterGraduation: true }}
      onChange={() => {}} onClose={() => {}} />);
    expect(html).toContain("选择方式"); expect(html).toContain("插播上限");
  });
  // 无服务、无学习数据库的静态视觉检查；显式运行时用发布构建的真实 CSS。
  it.skipIf(process.env.SPELLING_VISUAL_QA !== "1")("生成浅色和深色离线视觉样本", async () => {
    const { mkdirSync, readFileSync, readdirSync, writeFileSync } = await import("node:fs");
    const assets = new URL("../../../dist/assets/", import.meta.url);
    const css = readdirSync(assets).filter((name) => name.endsWith(".css")).map((name) => readFileSync(new URL(name, assets), "utf8")).join("\n")
      + readFileSync(new URL("../../pages/spelling.css", import.meta.url), "utf8");
    const output = new URL("../../../.local/spelling-b3-visual/", import.meta.url);
    mkdirSync(output, { recursive: true });
    const html = renderToStaticMarkup(<section className="sp-page"><SpellingSettings
      prefs={{ ...DEFAULT_SPELLING_PREFS, modes: ["meaning", "audio", "cloze"], inlineAfterGraduation: true }}
      onChange={() => {}} onClose={() => {}} /></section>);
    for (const theme of ["light", "dark"]) writeFileSync(new URL(`${theme}.html`, output),
      `<html data-theme="${theme}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>B3 拼写设置 ${theme}</title><style>${css}</style></head><body>${html}</body></html>`);
  }, 30000);
});
