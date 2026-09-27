import { afterEach, describe, expect, it, vi } from "vitest";
import { pickImageDataUrl } from "./pick-image";

afterEach(() => vi.unstubAllGlobals());

describe("pickImageDataUrl", () => {
  it("returns null when the image picker is canceled", async () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("document", {
      createElement: () => ({
        type: "",
        accept: "",
        files: null,
        onchange: null,
        addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
        click: () => listeners.get("cancel")?.(new Event("cancel"))
      })
    });

    await expect(pickImageDataUrl()).resolves.toBeNull();
  });

  it("returns null when wx.chooseMedia is canceled", async () => {
    vi.stubGlobal("wx", {
      chooseMedia: ({ fail }: any) => fail({ errMsg: "chooseMedia:fail cancel" })
    });

    const { pickImageDataUrl: pickWeappImageDataUrl } = await import("./pick-image.weapp");
    await expect(pickWeappImageDataUrl()).resolves.toBeNull();
  });
});
