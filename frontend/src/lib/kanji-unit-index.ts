/**
 * 字音单位的运行时索引:惰性加载,主包不带。
 *
 * 完整索引 `kanji_reading_unit_index.json` 是 2.8 MB 的构建产物,里面大半是审计
 * 字段(unresolved / alignmentTies / manualReviewLog)和重复的 JSON 字段名。
 * 运行时只要三样:单位本身、打分要的例词 id、出题要的前几个例词切段。
 * 生成脚本另出一份元组编码的 `*_runtime.json`,**399 KB**,走动态 import 单独成
 * chunk —— grammar.ts 1.5 MB 静态进主包是前车之鉴。
 *
 * 加载方式抄 `furigana.ts`:调用方进模式前 fire-and-forget 调一次 load,
 * 之后所有读取都是同步的。没加载完就当索引为空,不阻塞、不抛错。
 */

export type KanjiUnitType = "char" | "jukujikun";
export type KanjiReadingKind = "on" | "kun";

/** 单位的级别序号:0=N5 … 4=N1,5=无级(用户自己导的词表,按最难档处理) */
export type KanjiUnitLevelRank = number;

export interface KanjiUnitRecord {
  unitKey: string;
  unitType: KanjiUnitType;
  char: string;
  base: string;
  surface: string;
  reading: string;
  kinds: KanjiReadingKind[];
  levelRank: KanjiUnitLevelRank;
  /** 这个单位在词库里出现在多少个词里 —— 覆盖收益的原始产量项 */
  occurrenceCount: number;
}

export interface KanjiUnitExample {
  wordId: number;
  start: number;
  length: number;
  reading: string;
  variant: string;
}

/** 元组编码,与 build-kanji-reading-unit-index.mjs 的 runtime 输出一一对应 */
type RuntimeUnitTuple = [number, string, string, string, string, number, number];
type RuntimeExampleTuple = [number, number, number, string, number];

interface RuntimePayload {
  version: string;
  levels: string[];
  variants: string[];
  exampleCap: number;
  units: RuntimeUnitTuple[];
  wordIds: number[][];
  examples: RuntimeExampleTuple[][];
}

interface LoadedIndex {
  version: string;
  levels: string[];
  units: KanjiUnitRecord[];
  byKey: Map<string, KanjiUnitRecord>;
  wordIdsByKey: Map<string, number[]>;
  examplesByKey: Map<string, KanjiUnitExample[]>;
}

let loaded: LoadedIndex | null = null;
let loading: Promise<void> | null = null;

const unitKeyOf = (unitType: KanjiUnitType, char: string, base: string, surface: string, reading: string) =>
  [unitType, char, base, surface, reading].join("|");

const decode = (payload: RuntimePayload): LoadedIndex => {
  const units: KanjiUnitRecord[] = [];
  const byKey = new Map<string, KanjiUnitRecord>();
  const wordIdsByKey = new Map<string, number[]>();
  const examplesByKey = new Map<string, KanjiUnitExample[]>();

  payload.units.forEach((tuple, position) => {
    const [typeFlag, char, base, surface, reading, kindBits, levelRank] = tuple;
    const unitType: KanjiUnitType = typeFlag === 0 ? "char" : "jukujikun";
    const kinds: KanjiReadingKind[] = [];
    // 1=on, 2=kun, 3=两者都是(23 个音训双属读音,不能只留一个)
    if (kindBits & 1) kinds.push("on");
    if (kindBits & 2) kinds.push("kun");
    const unitKey = unitKeyOf(unitType, char, base, surface, reading);
    const wordIds = payload.wordIds[position] ?? [];
    const record: KanjiUnitRecord = {
      unitKey, unitType, char, base, surface, reading, kinds, levelRank,
      occurrenceCount: wordIds.length
    };
    units.push(record);
    byKey.set(unitKey, record);
    wordIdsByKey.set(unitKey, wordIds);
    examplesByKey.set(unitKey, (payload.examples[position] ?? []).map(([wordId, start, length, exampleReading, variant]) => ({
      wordId, start, length, reading: exampleReading, variant: payload.variants[variant] ?? "base"
    })));
  });

  return { version: payload.version, levels: payload.levels, units, byKey, wordIdsByKey, examplesByKey };
};

export const loadKanjiUnitIndex = (): Promise<void> => {
  if (loaded) return Promise.resolve();
  loading ??= import("../data/kanji_reading_unit_runtime.json").then((module) => {
    loaded = decode((module.default ?? module) as unknown as RuntimePayload);
  });
  return loading;
};

export const kanjiUnitIndexLoaded = (): boolean => loaded !== null;

export const kanjiUnitIndexVersion = (): string => loaded?.version ?? "";

/** JLPT 级别名,索引给的是序号 */
export const kanjiUnitLevels = (): string[] => loaded?.levels ?? [];

export const allKanjiUnits = (): readonly KanjiUnitRecord[] => loaded?.units ?? [];

export const kanjiUnitByKey = (unitKey: string): KanjiUnitRecord | null =>
  loaded?.byKey.get(unitKey) ?? null;

/** 打分用:这个单位出现在哪些词里(全量) */
export const kanjiUnitWordIds = (unitKey: string): readonly number[] =>
  loaded?.wordIdsByKey.get(unitKey) ?? [];

/** 出题用:前几个例词的切段(构建期已截断到 exampleCap) */
export const kanjiUnitExamples = (unitKey: string): readonly KanjiUnitExample[] =>
  loaded?.examplesByKey.get(unitKey) ?? [];

/**
 * 到某个级别为止需要掌握的单位数。**软排序**:目标级别不排除更高级的单位,
 * 只影响排序权重,所以这里算的是「分母」,不是「白名单」。
 */
export const kanjiUnitsUpToLevel = (levelRank: number): KanjiUnitRecord[] =>
  allKanjiUnits().filter((unit) => unit.levelRank <= levelRank);
