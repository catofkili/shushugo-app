import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDiagnostics, recordDiagnosticError, recordDiagnosticRoute } from "./diagnostics";

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

describe("diagnostics allowlist", () => {
  it("does not include notes, email, OpenID, or unique device values from local storage", () => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    localStorage.setItem("study-notes", "私の大事な便签");
    localStorage.setItem("mn_cloud_sync_email", "learner@example.com");
    localStorage.setItem("openid", "openid-secret-123");
    localStorage.setItem("device-id", "unique-device-456");
    recordDiagnosticRoute("profile");
    recordDiagnosticError(new Error("failed for learner@example.com"));

    const snapshot = JSON.stringify(collectDiagnostics());
    expect(snapshot).not.toContain("私の大事な便签");
    expect(snapshot).not.toContain("learner@example.com");
    expect(snapshot).not.toContain("openid-secret-123");
    expect(snapshot).not.toContain("unique-device-456");
    expect(snapshot).toContain("[email]");
    expect(collectDiagnostics().appVersion).toBe(__APP_VERSION__);
    expect(collectDiagnostics().route).toBe("profile");
  });
});
