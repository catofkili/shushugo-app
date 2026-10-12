/** SAP1: 4-byte magic + little-endian JSON length + ASCII index + concatenated ADTS AAC. */
export type AudioClipLocation = [pack: number, offset: number, length: number];
export interface AudioPackVoice {
  id: string; label: string; ext: string; engine: string; count: number; complete: boolean;
  packs: [name: string, bytes: number][];
  clips: Record<string, AudioClipLocation>;
}
export interface AudioPackIndex { format: 1; default: string; voices: AudioPackVoice[] }
/** The wire catalog shares hash keys across voices; disk/runtime use the expanded map. */
export interface AudioPackWireIndex {
  format: 1; default: string; keys: string[];
  voices: (Omit<AudioPackVoice, "clips"> & { clips: (AudioClipLocation | null)[] })[];
}
export interface AudioPackPointer { version: string }
export const AUDIO_CACHE_BYTES = 80 * 1024 * 1024;
export const clipKey = (kind: "words" | "examples", hash: string) => `${kind === "words" ? "w" : "e"}:${hash}`;
const validKey = (key: string) => /^[we]:[0-9a-f]{16}$/.test(key);

export function encodeAudioPack(clips: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const index: Record<string, [number, number]> = {};
  let size = 0;
  for (const [key, bytes] of clips) {
    if (!validKey(key) || !bytes.length) throw new Error("Invalid audio clip");
    index[key] = [size, bytes.length];
    size += bytes.length;
  }
  const json = JSON.stringify(index);
  const out = new Uint8Array(8 + json.length + size);
  out.set([83, 65, 80, 49]);
  new DataView(out.buffer).setUint32(4, json.length, true);
  for (let i = 0; i < json.length; i++) out[8 + i] = json.charCodeAt(i);
  let offset = 8 + json.length;
  for (const bytes of clips.values()) { out.set(bytes, offset); offset += bytes.length; }
  return out;
}

/** Validate every range before persisting a downloaded pack; partial downloads never become cache hits. */
export function decodeAudioPack(bytes: Uint8Array): Record<string, [number, number]> {
  if (bytes.length < 10 || bytes[0] !== 83 || bytes[1] !== 65 || bytes[2] !== 80 || bytes[3] !== 49) throw new Error("Invalid SAP1 header");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (length > 256 * 1024 || 8 + length > bytes.length) throw new Error("Invalid SAP1 index length");
  let json = "";
  for (const b of bytes.subarray(8, 8 + length)) { if (b > 127) throw new Error("Invalid SAP1 index"); json += String.fromCharCode(b); }
  const index = JSON.parse(json);
  if (!index || Array.isArray(index) || typeof index !== "object") throw new Error("Invalid SAP1 index");
  let end = 8 + length;
  for (const [key, value] of Object.entries(index)) {
    if (!validKey(key) || !Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || !Number.isSafeInteger(value[1]) || value[0] !== end - 8 - length || value[1] <= 0) throw new Error("Invalid SAP1 range");
    index[key] = [end, value[1]];
    end += value[1];
    if (end > bytes.length) throw new Error("Truncated SAP1 audio");
  }
  if (end !== bytes.length) throw new Error("Invalid SAP1 payload length");
  return index;
}

export function validateAudioPackIndex(value: unknown): AudioPackIndex {
  let index = value as AudioPackIndex;
  const keys = (value as AudioPackWireIndex)?.keys;
  if (keys !== undefined) {
    if (!Array.isArray(keys) || keys.some(k => !validKey(k)) || new Set(keys).size !== keys.length || !Array.isArray(index?.voices)) throw new Error("Invalid audio catalog keys");
    index = { format: 1, default: index.default, voices: index.voices.map(v => {
      if (!Array.isArray(v.clips) || v.clips.length !== keys.length) throw new Error("Invalid audio catalog slots");
      return { ...v, clips: Object.fromEntries(keys.flatMap((key, i) => v.clips[i] === null ? [] : [[key, v.clips[i]]])) };
    }) };
  }
  if (index?.format !== 1 || index.default !== "voicevox-8" || !Array.isArray(index.voices) || !index.voices.some(v => v.id === index.default)) throw new Error("Invalid audio pack catalog");
  const ids = new Set<string>();
  for (const v of index.voices) {
    if (!/^voicevox-(8|10|11)$/.test(v.id) || ids.has(v.id) || typeof v.label !== "string" || v.ext !== ".aac" || v.engine !== "voicevox" || !Number.isSafeInteger(v.count) || v.count <= 0 || typeof v.complete !== "boolean" || !Array.isArray(v.packs) || !v.clips || Array.isArray(v.clips) || typeof v.clips !== "object") throw new Error("Invalid audio pack voice");
    ids.add(v.id);
    for (const [name, size] of v.packs) if (!new RegExp(`^${v.id}/[a-z0-9-]+-[0-9a-f]{64}\\.sap$`).test(name) || !Number.isSafeInteger(size) || size <= 0 || size > 2 * 1024 * 1024) throw new Error("Invalid audio pack file");
    for (const [key, loc] of Object.entries(v.clips)) if (!validKey(key) || !Array.isArray(loc) || loc.length !== 3 || loc.some(n => !Number.isSafeInteger(n)) || !v.packs[loc[0]] || loc[1] < 8 || loc[2] <= 0 || loc[1] + loc[2] > v.packs[loc[0]][1]) throw new Error("Invalid audio pack mapping");
  }
  return index;
}
