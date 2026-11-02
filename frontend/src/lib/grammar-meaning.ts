/**
 * 语法「中文意」里的表格：含「｜」的行是表格行（第一行是表头），其余行是普通段落。
 * 不单开字段：meaning 是种子、云同步、搜索都认的那一列，一个字符串就能带表格过去。
 */
export type MeaningBlock = { text: string } | { rows: string[][] };

export function parseMeaning(meaning: string): MeaningBlock[] {
  const blocks: MeaningBlock[] = [];
  for (const line of meaning.split("\n")) {
    if (!line.includes("｜")) {
      if (line.trim()) blocks.push({ text: line });
      continue;
    }
    const last = blocks[blocks.length - 1];
    const cells = line.split("｜");
    if (last && "rows" in last) last.rows.push(cells);
    else blocks.push({ rows: [cells] });
  }
  return blocks;
}

/** 单行位置（列表、收藏、气泡）只放第一行，不把表格摊成一长串。 */
export const meaningSummary = (meaning: string) => meaning.split("\n")[0];
