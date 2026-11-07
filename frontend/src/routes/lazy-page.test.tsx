import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { lazyPage } from "./lazy-page";

describe("lazyPage", () => {
  it("按需加载、合并并发预取，预取后首次渲染不进入 Suspense", async () => {
    const load = vi.fn(async () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
    const Page = lazyPage(load);
    expect(load).not.toHaveBeenCalled();
    const first = Page.preload();
    expect(Page.preload()).toBe(first);
    await first;
    expect(renderToStaticMarkup(<Page text="ready" />)).toBe("<p>ready</p>");
    expect(load).toHaveBeenCalledOnce();
  });
  it("预取失败后可以重试，不能永久缓存 rejected promise", async () => {
    const load = vi.fn<() => Promise<{ default: () => React.ReactNode }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ default: () => <p>ready</p> });
    const Page = lazyPage(load);
    await expect(Page.preload()).rejects.toThrow("offline");
    await Page.preload();
    expect(renderToStaticMarkup(<Page />)).toBe("<p>ready</p>");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
