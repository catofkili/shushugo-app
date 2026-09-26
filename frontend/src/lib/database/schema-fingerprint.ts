import { firstValue, rowsFor, setState } from "./db-utils";

/**
 * DDL cache key, not a security digest. Two independent 32-bit hashes make accidental
 * collisions sufficiently unlikely while keeping this synchronous in WeChat's JS runtime.
 */
export function hashSchemaDefinition(parts: readonly unknown[]): string {
  const source = parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\u001e");
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

export function hasSchemaFingerprint(key: string, fingerprint: string): boolean {
  if (!rowsFor("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").length) return false;
  return firstValue<string>("SELECT value FROM app_state WHERE key = ?", [key], "") === fingerprint;
}

export function saveSchemaFingerprint(key: string, fingerprint: string): void {
  setState(key, fingerprint);
}
