import type { FuriganaAnnotation, TokenBoundary, TokenMorph } from "../types/furigana";

const isAnnotation = (value: unknown): value is FuriganaAnnotation => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FuriganaAnnotation>;
  return Number.isInteger(item.start)
    && Number.isInteger(item.length)
    && Number(item.start) >= 0
    && Number(item.length) > 0
    && typeof item.reading === "string"
    && item.reading.length > 0;
};

const normalizeAnnotation = (value: unknown): FuriganaAnnotation | null => {
  if (Array.isArray(value) && value.length >= 3) {
    const [start, length, reading] = value;
    return isAnnotation({ start, length, reading }) ? { start, length, reading } : null;
  }
  return isAnnotation(value) ? value : null;
};

/** Parse the JSON stored in the local SQLite example_furigana columns. */
export const parseFurigana = (raw: unknown): FuriganaAnnotation[] | undefined => {
  if (Array.isArray(raw)) {
    const parsed = raw.map(normalizeAnnotation).filter((item): item is FuriganaAnnotation => Boolean(item));
    return parsed.length ? parsed : undefined;
  }
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const annotations = parsed.map(normalizeAnnotation).filter((item): item is FuriganaAnnotation => Boolean(item));
    return annotations.length ? annotations : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Expand the build-time token length string into UTF-16 text spans.
 *
 * The lengths are deliberately validated against the sentence: a stale or
 * malformed row must never make a selection point at a different character.
 */
interface TokenLemmaMetadata {
  lemma: string;
  morphs?: TokenMorph[];
}

const parseMorph = (value: unknown): TokenMorph | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TokenMorph>;
  if (typeof item.surface !== "string" || !item.surface
    || typeof item.lemma !== "string" || !item.lemma
    || typeof item.pos !== "string" || typeof item.detail !== "string") return null;
  return {
    surface: item.surface,
    lemma: item.lemma,
    ...(item.reading ? { reading: item.reading } : {}),
    pos: item.pos,
    detail: item.detail,
    ...(item.conjugatedType ? { conjugatedType: item.conjugatedType } : {}),
    ...(item.conjugatedForm ? { conjugatedForm: item.conjugatedForm } : {})
  };
};

const parseLemmaMap = (raw: unknown): Record<string, TokenLemmaMetadata> => {
  if (!raw) return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!/^\d+$/u.test(key)) return [];
    if (typeof item === "string" && item.trim()) return [[key, { lemma: item.trim() }]];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const rawLemma = (item as { lemma?: unknown }).lemma;
    if (typeof rawLemma !== "string" || !rawLemma.trim()) return [];
    const morphs = Array.isArray((item as { morphs?: unknown }).morphs)
      ? (item as { morphs: unknown[] }).morphs.map(parseMorph).filter((m): m is TokenMorph => Boolean(m))
      : [];
    return [[key, { lemma: rawLemma.trim(), ...(morphs.length ? { morphs } : {}) }]];
  }));
};

export const parseTokenBoundaries = (raw: unknown, text: string, rawLemmas?: unknown): TokenBoundary[] | undefined => {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const lengths = raw.split(",").map((value) => Number(value));
  if (!lengths.length || lengths.some((length) => !Number.isInteger(length) || length === 0)) return undefined;
  const total = lengths.reduce((sum, length) => sum + Math.abs(length), 0);
  if (total !== text.length) return undefined;
  const lemmas = parseLemmaMap(rawLemmas);
  let cursor = 0;
  return lengths.map((length, index) => {
    const spanLength = Math.abs(length);
    const start = cursor;
    cursor += spanLength;
    const metadata = lemmas[String(index)];
    return {
      start,
      end: cursor,
      text: text.slice(start, cursor),
      clickable: length > 0,
      ...(metadata ? {
        lemma: metadata.lemma,
        ...(metadata.morphs ? { morphs: metadata.morphs } : {})
      } : {})
    };
  });
};

/** Find the token containing a UTF-16 selection offset. */
export const tokenBoundaryAtOffset = (
  boundaries: TokenBoundary[] | undefined,
  offset: number
): TokenBoundary | undefined => boundaries?.find(({ start, end }) => offset >= start && offset < end);
