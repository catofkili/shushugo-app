import { describe, expect, it, vi } from "vitest";
import { pageShareButtonProps } from "./page-share";
import { pageShareButtonProps as weappButtonProps, shareAppMessage } from "./page-share.weapp";

const progress = { title: "我们队本期第 9 天全员过关", path: "/study/team/index" };
const invite = { title: "加入我们的学习队伍", path: "/study/team/index?invite=ABCD2345" };

describe("page sharing", () => {
  it("keeps the web share handler and lets WeChat trigger sharing natively", () => {
    const onClick = vi.fn();
    pageShareButtonProps(progress, onClick).onClick();
    expect(onClick).toHaveBeenCalledOnce();
    const native = weappButtonProps(invite, onClick);
    expect(native.openType).toBe("share");
    expect(native).not.toHaveProperty("onClick");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("distinguishes invitation and progress buttons without relying on a prior tap", () => {
    expect(shareAppMessage({ from: "button", target: { dataset: { shareTitle: invite.title, sharePath: invite.path } } }, progress)).toEqual(invite);
    expect(shareAppMessage({ from: "button", target: { dataset: { shareTitle: progress.title, sharePath: progress.path } } }, invite)).toEqual(progress);
    expect(progress.path).not.toContain("invite");
  });

  it("uses the current page card for the menu and for missing button data", () => {
    expect(shareAppMessage({ from: "menu" }, progress)).toEqual(progress);
    expect(shareAppMessage({ from: "menu", target: { dataset: { shareTitle: invite.title, sharePath: invite.path } } }, progress)).toEqual(progress);
    expect(shareAppMessage({ from: "button", target: { dataset: { shareTitle: 123 } } }, progress)).toEqual(progress);
  });
});
