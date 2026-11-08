/**
 * 离线人设基线，默认跳过；生产模块从不import本目录。
 * SHUSHUGO_PERSONA_SIM=1 ./node_modules/.bin/vitest run src/lib/persona-sim/persona-load-simulation.test.ts --configLoader runner --no-cache
 * PERSONA_SIM_SMOKE=1 同一命令：cram/break各2种子、10天，并逐字节复跑一个种子。
 * PERSONA_SIM_IDS=self 等可逐人设运行；每个子进程至多2个种子、19分钟，原始分片可恢复汇总。
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Console } from "node:console";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { dirname, isAbsolute } from "node:path";
import initSqlJs, { type Database } from "sql.js";

let testDb: Database;
const preferences = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, String(value)), removeItem: (key: string) => preferences.delete(key) },
  window: { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined }
});
vi.mock("../database", () => ({ getDatabase: () => testDb, initDatabase: async () => testDb, exportDatabase: () => null }));
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname }));
vi.mock("../storage", () => ({ scheduleSave: vi.fn(), requestFullSnapshot: vi.fn() }));
vi.mock("../database/db-utils", async importOriginal => ({
  ...await importOriginal<typeof import("../database/db-utils")>(), persistSoon: vi.fn(), persistContentSoon: vi.fn()
}));

import { calibrate } from "./calibration";
import { burdenProbability, byKind, KINDS, logNormal, metricsFor, mulberry32, PERSONAS, reviewProbability, type Daily, type Persona, type Run } from "./model";
import { loadMixedCardData, preparedLightFixture, simulate, type Environment } from "./simulator";
import { renderComparison, renderReport, type Summary } from "./report";
import type { Policy } from "./budget-policy";

vi.stubEnv("TZ", "Asia/Singapore");
const console = new Console(process.stdout, process.stderr);
const cwd = fileURLToPath(new URL("../../..", import.meta.url));
const livePath = process.env.SHUSHUGO_LIVE_DB ?? `${cwd}/.local/live.db`;
const smoke = process.env.PERSONA_SIM_SMOKE === "1";
const comparison = process.env.PERSONA_SIM_COMPARE;
const policyValue = process.env.PERSONA_SIM_POLICY ?? "current";
if (policyValue !== "current" && policyValue !== "budget") throw new Error(`未知排法 ${policyValue}`);
const policy: Policy = policyValue;
const batch: { id: string; seeds: number[]; days: number } | null = process.env.PERSONA_SIM_BATCH ? JSON.parse(process.env.PERSONA_SIM_BATCH) : null;
const RUN = !comparison && (process.env.SHUSHUGO_PERSONA_SIM === "1" || smoke || !!batch);
const output = process.env.PERSONA_SIM_OUTPUT ?? `${cwd}/.local/persona-sim${smoke ? "/smoke" : ""}`;
if (!isAbsolute(output)) throw new Error("PERSONA_SIM_OUTPUT必须为绝对路径");
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
// worktree里的模拟器不提交；仅用HEAD不能识别草稿改动，会把不同规则的分片混成一套。
const sourceHash = createHash("sha256").update(["persona-load-simulation.test.ts", "model.ts", "simulator.ts", "harness.ts", "calibration.ts", "budget-policy.ts", "../plan/budget-allocator.ts"]
  .map(name => readFileSync(new URL(name, import.meta.url), "utf8")).join("\n")).digest("hex");
const simulationHash = createHash("sha256").update(`${sourceHash}\n${policy}`).digest("hex");
const children = new Set<ChildProcess>();
// self 从 73 MB 真实库起步，一个种子 60 天约 20 分钟：原来写死 19 分钟会被误杀（2026-11-02 实测 exit 143）。
const PARALLEL = Number(process.env.PERSONA_SIM_PARALLEL ?? 2);
const CHILD_TIMEOUT_MS = Number(process.env.PERSONA_SIM_CHILD_TIMEOUT_MS ?? 3_600_000);
let environment: Environment;
let liveHash = "";
let factoryHash = "";

beforeAll(async () => {
  if (!RUN) return;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("人设模拟禁止联网"); }));
  const SQL = await initSqlJs();
  const bytes = readFileSync(livePath);
  liveHash = createHash("sha256").update(bytes).digest("hex");
  const peek = new SQL.Database(new Uint8Array(bytes));
  const calibration = calibrate(peek); peek.close();
  if (calibration.method !== "replay-R") throw new Error("历史R重放不完整；应先核实并实现间隔分桶退路");
  const factory = readFileSync(`${cwd}/public/nihongo.db`);
  factoryHash = createHash("sha256").update(factory).digest("hex");
  environment = { SQL, calibration, livePath, preferences, policy,
    factory: new Uint8Array(factory), setDatabase: db => { testDb = db; } };
  if (process.env.PERSONA_SIM_LIGHT_FIXTURE) {
    const path = process.env.PERSONA_SIM_LIGHT_FIXTURE;
    environment.lightFixture = { bytes: new Uint8Array(readFileSync(path)), preferences: JSON.parse(readFileSync(`${path}.json`, "utf8")) };
  }
  await loadMixedCardData();
  if (smoke && !batch) console.log(`self系数（旧→新）${KINDS.map(k => `${k}=${calibration.previousCoefficients[k].toFixed(6)}→${calibration.coefficients[k].toFixed(6)}`).join("，")}`);
  const storage = await vi.importActual<typeof import("../storage")>("../storage");
  vi.spyOn(storage, "scheduleSave").mockImplementation(() => undefined);
  vi.spyOn(storage, "requestFullSnapshot").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  mkdirSync(`${output}/parts`, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const child of children) child.kill();
  if (RUN) expect(createHash("sha256").update(readFileSync(livePath)).digest("hex"), "冻结库不得被修改").toBe(liveHash);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
});

const configured = (id: string): Persona => {
  const p = PERSONAS.find(p => p.id === id);
  if (!p) throw new Error(`未知人设 ${id}`);
  return id === "self" ? { ...p, minutes: environment.calibration.baseMinutes, absence: environment.calibration.absence,
    coefficient: environment.calibration.coefficients, first: environment.calibration.firstAccuracy, prior: environment.calibration.priorAccuracy } : p;
};

const enabled = RUN ? it : it.skip;
(comparison ? it : it.skip)("从两份summary生成排法对比，不启动模拟", () => {
  const directories = comparison!.split(",");
  if (directories.length !== 2 || directories.some(p => !isAbsolute(p))) throw new Error("PERSONA_SIM_COMPARE需要两个绝对输出目录，顺序current,budget");
  const [current, budget] = directories.map(path => JSON.parse(readFileSync(`${path}/summary.json`, "utf8")) as Summary);
  const report = renderComparison(current, budget);
  const target = process.env.PERSONA_SIM_COMPARE_OUT ?? `${cwd}/../docs/audits/2026-11-05-budget-sim-compare.md`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, report);
  expect(report).toContain("## 验收线");
  console.log(`对比报告 ${target}`);
});
enabled("模拟人边界：种子、疲劳、负担概率与长尾时间", () => {
  const a = mulberry32(123), b = mulberry32(123), c = mulberry32(124);
  const seq = Array.from({ length: 100 }, () => a());
  expect(seq).toEqual(Array.from({ length: 100 }, () => b()));
  expect(seq).not.toEqual(Array.from({ length: 100 }, () => c()));
  expect(burdenProbability(0.1, 60, 30)).toBeCloseTo(0.25);
  expect(burdenProbability(0.25, 600, 15)).toBe(0.6);
  expect(burdenProbability(0.1, 0, 0)).toBe(0.1);
  expect(reviewProbability(0.9, 1, 0)).toBe(0.9);
  expect(reviewProbability(0.9, 1, 120)).toBeCloseTo(0.81);
  expect(reviewProbability(0, 1, 0)).toBe(0.02);
  expect(reviewProbability(1, 1.1, 0)).toBe(0.99);
  const rng = mulberry32(321), times = Array.from({ length: 10_000 }, () => logNormal(rng));
  expect(times.every(n => n > 0 && Number.isFinite(n))).toBe(true);
});

enabled("指标保留完整交接窗口、恢复耗时与未恢复截尾", () => {
  const days: Daily[] = Array.from({ length: 22 }, (_, i) => {
    const day = i + 1, absent = [7, 8, 20].includes(day);
    const backlog = day < 7 ? 10 : day <= 9 ? 25 : day === 10 ? 13 : day <= 19 ? 12 : 20;
    return { seed: 1, day, date: `2026-01-${String(day).padStart(2, "0")}`, baseMinutes: 10,
      availableMinutes: 10, absenceProbability: 0.1, active: !absent, absence: absent ? "base" : "none",
      shouldMinutes: day < 8 ? 10 : 20, actualMinutes: 5, feasible: null, relief: 0, tail: 0,
      kana: { planned: 0, taught: 0, wordTaught: 0, answers: 0, mastered: 0 },
      cards: byKind(k => ({ planned: day < 8 ? 10 : 20, plannedFresh: 1, releasedPrior: 0,
        answers: 1, fresh: absent || day === 9 ? 0 : 1, prior: 0, review: 0, relearn: 0, reviewCorrect: 0,
        backlog: k === "words" ? backlog : 0, pendingPrior: 0, scheduledRemaining: 0 })),
      quotas: byKind(() => ({ savedFresh: 1, effectiveFresh: 1, savedReview: 0, effectiveReview: 60, reasons: [] })) };
  });
  const m = metricsFor([{ seed: 1, days, transitions: [{ seed: 1, day: 8, kind: "words", type: "content", from: "N4", to: "N3" }],
    events: [], selfGap: null, coverage: { day: 22, date: days[21].date, reason: "lastDay",
      cards: byKind(() => ({ seen: 1, total: 2, percent: 50, stateSeen: 2, statePercent: 100 })) } }]);
  expect(m.M2.events[0]).toMatchObject({ ratio: 2, beforeDays: 7, afterDays: 15, noFreshDays: 3, truncated: false });
  expect(m.M3.episodes[0]).toMatchObject({ returnDay: 9, baseline: 10, days: 2 });
  expect(m.M3.episodes[1]).toMatchObject({ returnDay: 21, days: null });
  expect(m.M3.unrecovered?.median).toBe(1);
  expect(m.M4.coverage.words?.worst).toBe(50);
});

if (batch) enabled(`人设 ${batch.id} 种子 ${batch.seeds.join(",")}`, async () => {
  const began = performance.now(), p = configured(batch.id), runs: Run[] = [];
  for (const seed of batch.seeds) {
    const started = performance.now();
    const run = await simulate(p, seed, batch.days, environment);
    runs.push(run);
    console.log(`${batch.id} seed=${seed} days=${batch.days} ${(performance.now() - started).toFixed(0)}ms`);
    if (smoke && seed === 1) {
      const repeated = await simulate(p, seed, batch.days, environment);
      expect(JSON.stringify(repeated), "同种子完整结果逐字节一致").toBe(JSON.stringify(run));
    }
  }
  const elapsedSeconds = (performance.now() - began) / 1000;
  const path = `${output}/parts/${p.id}-${batch.seeds[0]}-${batch.days}.json`;
  writeFileSync(`${path}.tmp`, JSON.stringify({
    gitHead, sourceHash, simulationHash, policy, liveHash, factoryHash, id: p.id, seeds: batch.seeds, days: batch.days, elapsedSeconds, runs
  }));
  renameSync(`${path}.tmp`, path);
}, CHILD_TIMEOUT_MS);

interface Part { gitHead: string; sourceHash: string; simulationHash: string; policy: Policy; liveHash: string; factoryHash: string; id: string; seeds: number[]; days: number; elapsedSeconds: number; runs: Run[] }
const savedPart = (piece: { id: string; seeds: number[]; days: number }): Part | null => {
  try {
    const part: Part = JSON.parse(readFileSync(`${output}/parts/${piece.id}-${piece.seeds[0]}-${piece.days}.json`, "utf8"));
    return part.id === piece.id && part.gitHead === gitHead && part.simulationHash === simulationHash && part.liveHash === liveHash && part.factoryHash === factoryHash
      && part.policy === policy && part.days === piece.days && JSON.stringify(part.seeds) === JSON.stringify(piece.seeds)
      && JSON.stringify(part.runs.map(r => r.seed)) === JSON.stringify(piece.seeds)
      && part.runs.every(r => r.days.length === piece.days && r.days.every((d, i) => d.day === i + 1 && d.seed === r.seed)) ? part : null;
  } catch { return null; }
};
if (!batch) enabled(smoke ? "人设smoke：2×2×10天" : "按人设分批跑完整基线", async () => {
  const began = performance.now();
  const startedAt = performance.timeOrigin + began;
  const ids = (process.env.PERSONA_SIM_IDS ?? (smoke ? "cram,break" : PERSONAS.map(p => p.id).join(","))).split(",");
  const seeds = smoke ? 2 : Number(process.env.PERSONA_SIM_SEEDS ?? 20);
  expect(Number.isInteger(seeds) && seeds >= (smoke ? 2 : 10)).toBe(true);
  const range = process.env.PERSONA_SIM_RANGE?.split("-").map(Number) ?? [1, seeds];
  expect(range.length === 2 && range[0] >= 1 && range[1] <= seeds && range[0] <= range[1]).toBe(true);
  const selected = ids.map(id => configured(id));
  for (const p of selected) {
    // 固定合成前史只建立一次；缓存仅含出厂内容+合成流水，与live.db无关。
    // 用gitHead隔离不同排法/FSRS版本；孩子仍各自开内存库，绝不共享未来作答。
    if (p.id === "light") {
      const fixturePath = `${output}/light-history-${gitHead}-${simulationHash.slice(0, 12)}-${factoryHash.slice(0, 12)}-${environment.calibration.start}.db`;
      if (!existsSync(fixturePath) || !existsSync(`${fixturePath}.json`)) {
        await simulate(p, 0, 0, environment);
        const fixture = preparedLightFixture();
        writeFileSync(fixturePath, fixture.bytes); writeFileSync(`${fixturePath}.json`, JSON.stringify(fixture.preferences));
      }
      process.env.PERSONA_SIM_LIGHT_FIXTURE = fixturePath;
    }
    // 每个完整种子立即原子落盘；重启跳过有效分片，不因为另一种子超时丢掉已完成计算。
    const size = smoke ? 2 : 1;
    const batches = Array.from({ length: Math.ceil(seeds / size) }, (_, i) => ({ id: p.id,
      seeds: Array.from({ length: size }, (_, j) => i * size + j + 1).filter(seed => seed <= seeds), days: smoke ? 10 : p.days }))
    const pending = batches.filter(piece => piece.seeds.every(seed => seed >= range[0] && seed <= range[1]) && !savedPart(piece));
    // 一个人设一个批组；两个进程并行，完整保留四类共享队列，不按题型拆库。
    for (let offset = 0; offset < pending.length; offset += PARALLEL) await Promise.all(pending.slice(offset, offset + PARALLEL).map(async piece => {
      const child = spawn(process.execPath, [`${cwd}/node_modules/vitest/vitest.mjs`, "run", "src/lib/persona-sim/persona-load-simulation.test.ts",
        "--configLoader", "runner", "--no-cache", "--maxWorkers", "1", "--reporter", "dot"], {
        cwd, env: { ...process.env, PERSONA_SIM_BATCH: JSON.stringify(piece), npm_config_offline: "true" }, stdio: ["ignore", "pipe", "pipe"]
      });
      children.add(child);
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk.toString();
        for (const progress of chunk.toString().match(/(?:self|zero|cram-lock|cram|office|break|fast|struggle|light) seed=\d+ D\d+\/\d+\n/gu) ?? []) process.stdout.write(progress);
      });
      child.stderr.on("data", chunk => { output += chunk.toString(); });
      const timer = setTimeout(() => child.kill("SIGTERM"), CHILD_TIMEOUT_MS);
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
      clearTimeout(timer); children.delete(child);
      expect(code, output.slice(-12000)).toBe(0);
      console.log(`完成 ${p.id} seeds=${piece.seeds.join(",")}`);
    }));
    const parts = batches.flatMap(piece => { const part = savedPart(piece); return part ? [part] : []; });
    const runs = parts.flatMap(part => part.runs).filter(run => run.seed <= seeds).sort((a, b) => a.seed - b.seed);
    if (runs.length < seeds) { console.log(`${p.id}已保存${runs.length}/${seeds}个种子，等待余下分片`); continue; }
    expect(runs.map(run => run.seed)).toEqual(Array.from({ length: seeds }, (_, i) => i + 1));
    const persona = { gitHead, sourceHash, simulationHash, policy, liveHash, factoryHash, id: p.id, name: p.name, seeds, days: smoke ? 10 : p.days, parameters: p,
      elapsedSeconds: parts.reduce((s, part) => s + part.elapsedSeconds, 0),
      initial: (runs[0] as Run & { initial: unknown }).initial, metrics: metricsFor(runs),
      transitions: runs.flatMap(run => run.transitions), events: runs.flatMap(run => run.events.map(e => ({ seed: run.seed, ...e }))),
      daily: runs.flatMap(run => run.days) };
    writeFileSync(`${output}/${p.id}.json`, JSON.stringify(persona));
  }
  const personas = PERSONAS.flatMap(p => {
    try {
      const saved = JSON.parse(readFileSync(`${output}/${p.id}.json`, "utf8"));
      return saved.gitHead === gitHead && saved.simulationHash === simulationHash && saved.liveHash === liveHash && saved.factoryHash === factoryHash && saved.seeds === seeds && saved.policy === policy ? [saved] : [];
    } catch { return []; }
  });
  const finishedAt = performance.timeOrigin + performance.now();
  appendFileSync(`${output}/commands.jsonl`, JSON.stringify({ gitHead, sourceHash, simulationHash, policy, liveHash, ids, seeds, range, startedAt, finishedAt }) + "\n");
  const commands = readFileSync(`${output}/commands.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(c => c.gitHead === gitHead && c.simulationHash === simulationHash && c.liveHash === liveHash);
  const summary = { generatedAt: new Date(finishedAt).toISOString(), gitHead, sourceHash, simulationHash, policy, smoke, liveHash, factoryHash,
    calibration: environment.calibration, wallSecondsThisCommand: (performance.now() - began) / 1000,
    runtime: { wallSeconds: (Math.max(...commands.map(c => c.finishedAt)) - Math.min(...commands.map(c => c.startedAt))) / 1000, commands }, personas };
  writeFileSync(`${output}/summary.json`, JSON.stringify(summary));
  if (!smoke && policy === "current" && personas.length === PERSONAS.length) {
    // 历史基线不能被不同冻结库的新实验覆盖。
    writeFileSync(`${output}/current-report.md`, renderReport(summary));
  }
  for (const p of personas) expect(KINDS.every(k => p.metrics.M4.coverage[k]?.samples === p.seeds)).toBe(true);
  console.log(`人设批组墙钟 ${(performance.now() - began) / 1000}s，结果 ${output}/summary.json`);
}, 12 * 60 * 60 * 1000);
