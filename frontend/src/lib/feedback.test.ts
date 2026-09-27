import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sync-api", () => ({ postFeedbackReport: vi.fn() }));

import { postFeedbackReport } from "./sync-api";
import { claimErrorReport, flushPendingFeedback, submitFeedback } from "./feedback";

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
  it("answers immediately, keeps a failed send locally and retries it on the next flush", async () => {
    api.mockRejectedValueOnce(new Error("offline"));
    expect(await submitFeedback({ kind: "feedback", message: "这个按钮不好用", includeDiagnostics: false })).toBe("sent");
    await flushPendingFeedback();
    expect(JSON.parse(localStorage.getItem("mn-pending-feedback-reports") ?? "[]")).toHaveLength(1);

    api.mockResolvedValue(undefined);
    await flushPendingFeedback();
    expect(api).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem("mn-pending-feedback-reports") ?? "[]")).toEqual([]);
  });

  it("does not lose a report submitted while an earlier one is still being sent", async () => {
    let release!: () => void;
    api.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    api.mockResolvedValue(undefined);
    await submitFeedback({ kind: "feedback", message: "第一条", includeDiagnostics: false });
    await submitFeedback({ kind: "feedback", message: "第二条", includeDiagnostics: false });
    release();
    await flushPendingFeedback();
    await flushPendingFeedback();
    const sentMessages = api.mock.calls.map(([payload]) => (payload as { message: string }).message);
    expect(sentMessages).toEqual(["第一条", "第二条"]);
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

describe("serious error prompt threshold", () => {
  it("prompts once per error class for 24 hours, regardless of message text", () => {
    expect(claimErrorReport("error", "TypeError A", "word", 10_000)).toBe(true);
    expect(claimErrorReport("error", "TypeError B", "settings", 10_001)).toBe(false);
    expect(claimErrorReport("hang", "卡住了 8 秒", "word", 10_002)).toBe(true);
    expect(claimErrorReport("error", "TypeError B", "settings", 10_000 + 24 * 60 * 60_000)).toBe(true);
  });
});
