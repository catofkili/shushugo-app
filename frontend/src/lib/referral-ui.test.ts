import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { referralEarningsText, referralRules, referralShopLink } from "./referral-copy.weapp";
import type { Referral } from "./referral";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const luminance = (hex: string) => {
  const [r, g, b] = hex.match(/\w\w/g)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
};

describe("referral platform UI", () => {
  it("keeps mini-program invitation copy free of incentive wording and disables the shop link", () => {
    expect(referralRules).toBe("");
    expect(referralEarningsText({ inviterEarned: 100 } as Referral)).toBe("");
    expect(referralShopLink).toBe(false);
    const sources = ["../pages/InvitePage.tsx", "../../../taro-spike-2/src/study/invite/index.tsx"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
    expect(sources).not.toMatch(/柚子|奖励|套装|翻倍/);
  });
  it("gives dusk primary buttons WCAG AA text contrast in both modes", () => {
    const variants = [...css.matchAll(/(?:\[data-theme="dark"\])?\[data-skin="theme-dusk"\]\s*\{([^}]+)\}/g)];
    expect(variants).toHaveLength(2);
    for (const [, body] of variants) {
      const color = (name: string) => body.match(new RegExp(`--zoo-${name}:\\s*(#[0-9A-Fa-f]{6})`))![1];
      for (const background of ["primary", "primary-dark"]) expect(contrast(color(background), color("on-primary"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color("primary-deep"), color("cream"))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("opens a web ref deep link with prefill and focus, without claiming", async () => {
    vi.resetModules();
    vi.doMock("./studyMode", () => ({ getStudyMode: () => "classic", defaultStudyMode: "classic" }));
    vi.doMock("./grammarPreferences", () => ({ getGrammarLevelPreference: () => "All" }));
    vi.stubGlobal("window", { location: { href: "https://example.test/?ref=ABCD2345" } });
    try {
      const { getAppState } = await import("../app/app-store");
      expect(getAppState()).toMatchObject({ page: "invite", referralCode: "ABCD2345", referralFocus: true });
    } finally { vi.unstubAllGlobals(); vi.doUnmock("./studyMode"); vi.doUnmock("./grammarPreferences"); }
  });
});
