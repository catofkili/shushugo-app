// Shared build-time token metadata rules.  kuromoji supplies the POS and
// basic_form; this module turns that raw stream into the clickable blocks
// stored in the seed database.

const CLICKABLE_POS = new Set([
  "名詞",
  "動詞",
  "形容詞",
  "副詞",
  "連体詞",
  "感動詞",
  "接頭詞"
]);

// 文語・敬语补助动词不进入 JLPT 词典点击和出题池。它们仍保留在句子
// 原文里，但作为功能材料显示，避免把「たまえ」误查成一个普通词条。
export const NON_STUDY_AUXILIARY_LEMMAS = new Set([
  "たまう",
  "給う",
  "なさる",
  "くださる",
  "ござる",
  "おる",
  "申す",
  "もうす",
  "いらっしゃる"
]);

const stringValue = (value) => String(value ?? "");

export const isClickableStartToken = (token) => {
  const pos = stringValue(token?.pos);
  const detail = stringValue(token?.pos_detail_1);
  const lemma = basicForm(token);
  if (pos === "動詞" && NON_STUDY_AUXILIARY_LEMMAS.has(lemma)) return false;
  // Formal nouns (の・こと・ところ) and lexical prefixes (新・第) are
  // grammatical scaffolding, not useful standalone dictionary targets.
  if (pos === "名詞" && (detail === "非自立" || detail === "接尾")) return false;
  if (pos === "接頭詞") return false;
  return CLICKABLE_POS.has(pos);
};

export const isAttachToken = (token) => {
  const pos = stringValue(token?.pos);
  const detail = stringValue(token?.pos_detail_1);
  const surface = stringValue(token?.surface_form);
  if (pos === "助動詞") return true;
  if (pos === "動詞" && (detail === "接尾" || detail === "非自立")) return true;
  if (pos === "名詞" && detail === "接尾") return true;
  if (pos === "形容詞" && detail === "非自立") return true;
  return pos === "助詞" && detail === "接続助詞" && (surface === "て" || surface === "で" || surface === "ば");
};

const basicForm = (token) => {
  const value = stringValue(token?.basic_form);
  return value && value !== "*" ? value : stringValue(token?.surface_form);
};

const morphInfo = (token) => ({
  surface: stringValue(token?.surface_form),
  lemma: basicForm(token),
  reading: stringValue(token?.reading ?? token?.pronunciation),
  pos: stringValue(token?.pos),
  detail: stringValue(token?.pos_detail_1),
  conjugatedType: stringValue(token?.conjugated_type),
  conjugatedForm: stringValue(token?.conjugated_form)
});

/**
 * Merge a kuromoji token stream into Moji-like clickable blocks.
 *
 * The first token decides whether a block is clickable.  Functional words
 * never start a clickable block; only the explicitly listed inflectional
 * suffixes/connective particles may attach to an already clickable block.
 */
export const mergeTokenBlocks = (tokens) => {
  const blocks = [];
  let current = null;
  for (const token of tokens ?? []) {
    const surface = stringValue(token?.surface_form);
    if (!surface) continue;
    const canAttach = Boolean(current?.clickable) && isAttachToken(token);
    if (canAttach) {
      current.surface += surface;
      current.tokens.push(token);
      continue;
    }
    if (current) blocks.push(current);
    current = {
      surface,
      clickable: isClickableStartToken(token),
      lemma: basicForm(token),
      tokens: [token]
    };
  }
  if (current) blocks.push(current);
  return blocks;
};

export const buildTokenMetadata = (tokens) => {
  const blocks = mergeTokenBlocks(tokens);
  const lengths = blocks.map((block) => (block.clickable ? 1 : -1) * block.surface.length);
  const lemmas = {};
  blocks.forEach((block, index) => {
    if (!block.clickable || !block.lemma || block.lemma === block.surface) return;
    // Keep the old string shape for ordinary inflections.  Compound blocks
    // need the token chain so the runtime can validate and explain them.
    const needsMorphs = block.tokens.length > 2 || block.tokens.slice(1).some((token) => (
      (stringValue(token?.pos) === "動詞"
        && (stringValue(token?.pos_detail_1) === "非自立" || stringValue(token?.pos_detail_1) === "接尾"))
      || (stringValue(token?.pos) === "名詞" && stringValue(token?.pos_detail_1) === "接尾")
    ));
    lemmas[index] = needsMorphs
      ? { lemma: block.lemma, morphs: block.tokens.map(morphInfo) }
      : block.lemma;
  });
  return { blocks, lengths, lemmas };
};
