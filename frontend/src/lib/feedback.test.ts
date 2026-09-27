import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-api", () => ({ postFeedbackReport: vi.fn() }));

import { postFeedbackReport } from "./sync-api";
import { flushPendingFeedback, submitFeedback } from "./feedback";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const api = vi.mocked(postFeedbackReport);

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  api.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("feedback retry queue", () => {
  it("keeps a failed send locally and retries it on the next flush", async () => {
    api.mockRejectedValueOnce(new Error("offline"));
    expect(await submitFeedback({ kind: "feedback", message: "这个按钮不好用", includeDiagnostics: false })).toBe("queued");
    expect(JSON.parse(localStorage.getItem("mn-pending-feedback-reports") ?? "[]")).toHaveLength(1);

    api.mockResolvedValue(undefined);
    await flushPendingFeedback();
    expect(api).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem("mn-pending-feedback-reports") ?? "[]")).toEqual([]);
  });

  it("drops locally queued reports after the 180-day retention period", async () => {
    localStorage.setItem("mn-pending-feedback-reports", JSON.stringify([{
      id: "old",
      createdAt: Date.now() - 181 * 24 * 60 * 60_000,
      payload: { kind: "feedback", message: "old report" }
    }]));
    await flushPendingFeedback();
    expect(api).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("mn-pending-feedback-reports") ?? "[]")).toEqual([]);
  });
});
