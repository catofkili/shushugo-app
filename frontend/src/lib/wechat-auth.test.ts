import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  available: true,
  authorize: vi.fn()
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    isPluginAvailable: () => mocks.available
  },
  registerPlugin: () => ({ authorize: mocks.authorize })
}));

import { isWechatAppLoginAvailable, requestWechatAppCode } from "./wechat-auth";

const config = { appleEnabled: false, wechatAppEnabled: true, turnstileEnabled: false };

describe("wechat app auth bridge", () => {
  beforeEach(() => {
    mocks.native = true;
    mocks.available = true;
    mocks.authorize.mockReset();
  });

  it("requires server config, a native runtime, and the native plugin", () => {
    expect(isWechatAppLoginAvailable(config)).toBe(true);
    mocks.available = false;
    expect(isWechatAppLoginAvailable(config)).toBe(false);
    mocks.available = true;
    mocks.native = false;
    expect(isWechatAppLoginAvailable(config)).toBe(false);
    expect(isWechatAppLoginAvailable({ ...config, wechatAppEnabled: false })).toBe(false);
  });

  it("returns the code only when the native callback echoes the generated state", async () => {
    mocks.authorize.mockImplementation(async ({ state }: { state: string }) => ({ code: "wechat-code", state }));
    await expect(requestWechatAppCode(config)).resolves.toBe("wechat-code");
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ scope: "snsapi_userinfo" }));
  });

  it("rejects a callback with a mismatched state", async () => {
    mocks.authorize.mockResolvedValue({ code: "wechat-code", state: "wrong-state" });
    await expect(requestWechatAppCode(config)).rejects.toThrow("状态校验失败");
  });
});
