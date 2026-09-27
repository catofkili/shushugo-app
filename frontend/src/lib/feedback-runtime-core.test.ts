import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeReportCandidates } from "./feedback";
import { isRecoverableRuntimeError, startFeedbackRuntimeCore } from "./feedback-runtime-core";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

afterEach(() => vi.unstubAllGlobals());

describe("runtime report threshold", () => {
  it("records recoverable network, audio, and interruption errors without prompting", () => {
    expect(isRecoverableRuntimeError(new Error("Failed to fetch"))).toBe(true);
    expect(isRecoverableRuntimeError(new Error("这条云端音频暂不可用"))).toBe(true);
    expect(isRecoverableRuntimeError(new Error("The operation was aborted"))).toBe(true);
    expect(isRecoverableRuntimeError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("prompts for only the first uncaught error of the same class in one session", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    const candidates: string[] = [];
    const unsubscribe = subscribeReportCandidates((candidate) => candidates.push(candidate.message));
    let capture!: (error: Error) => void;
    const stop = startFeedbackRuntimeCore({
      bindErrors(onError) { capture = onError; return () => undefined; },
      subscribeVisibility() { return () => undefined; },
      isVisible: () => true
    });
    try {
      capture(new Error("First uncaught error"));
      capture(new Error("Second uncaught error"));
      expect(candidates).toEqual(["First uncaught error"]);
    } finally {
      stop();
      unsubscribe();
    }
  });
});
