/**
 * A precomputed ruby annotation over a Japanese sentence.
 *
 * `start` and `length` are UTF-16 code-unit offsets so the renderer can use
 * String#slice without converting coordinates at runtime.
 */
export interface FuriganaAnnotation {
  start: number;
  length: number;
  reading: string;
}

/** Minimal kuromoji evidence retained for a merged clickable block. */
export interface TokenMorph {
  surface: string;
  lemma: string;
  reading?: string;
  pos: string;
  detail: string;
  conjugatedType?: string;
  conjugatedForm?: string;
}

/** A kuromoji token boundary, stored as a compact comma-separated length string. */
export interface TokenBoundary {
  start: number;
  end: number;
  text: string;
  /** Negative baked lengths mark function words that must not open a lookup. */
  clickable: boolean;
  /** Sparse lemma supplied for inflected/merged blocks. */
  lemma?: string;
  /** Morphological evidence for compound predicates and suffix chains. */
  morphs?: TokenMorph[];
}
