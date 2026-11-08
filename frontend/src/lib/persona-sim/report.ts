import type { LevelPlanSettings } from "../level-plan";
import { SECONDS_PER_CARD } from "../daily-plan";
import { KINDS, PERSONAS, median, stats, type Daily, type Persona, type Quota, type Stats, type metricsFor } from "./model";
import type { Calibration } from "./calibration";
import { PRIOR_QUOTA_MAX } from "../prior-pacing";
import type { Policy } from "./budget-policy";

interface Initial {
  settings: LevelPlanSettings; quotas: Record<typeof KINDS[number], Quota>;
  levels: { level: string; words: { total: number; seen: number; stateSeen: number }; grammar: { total: number; seen: number; stateSeen: number } }[];
}
interface PersonaResult {
  id: string; name: string; seeds: number; days: number; parameters: Persona; initial: Initial;
  elapsedSeconds: number; metrics: ReturnType<typeof metricsFor>; daily: Daily[];
}
export interface Summary {
  generatedAt: string; gitHead: string; simulationHash: string; liveHash: string; calibration: Calibration;
  wallSecondsThisCommand: number; personas: PersonaResult[];
  runtime?: { wallSeconds: number; commands: { startedAt: number; finishedAt: number }[] };
  policy?: Policy; sourceHash?: string; smoke?: boolean; factoryHash?: string;
}

/** 指纹/样本先验证完才返回正文，调用方只在成功后写文件。 */
export function renderComparison(current: Summary, budget: Summary): string {
  if (current.policy !== "current" || budget.policy !== "budget") throw new Error("对比顺序必须为 current,budget");
  if (!current.sourceHash || current.sourceHash !== budget.sourceHash || current.gitHead !== budget.gitHead) throw new Error("两份代码指纹不一致，必须在同一代码上重跑两种排法");
  if (!current.liveHash || current.liveHash !== budget.liveHash) throw new Error("冻结库SHA-256不一致");
  if (!current.factoryHash || current.factoryHash !== budget.factoryHash) throw new Error("合成前史使用的出厂词库SHA-256不一致");
  if (JSON.stringify(current.calibration) !== JSON.stringify(budget.calibration)) throw new Error("标定输入不一致");
  const ids = current.personas.map(p => p.id).sort();
  if (!ids.length || new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(budget.personas.map(p => p.id).sort()) || current.smoke !== budget.smoke) throw new Error("人设集合或smoke模式不一致");
  for (const a of current.personas) {
    const b = budget.personas.find(p => p.id === a.id)!;
    const seedsOf = (p: PersonaResult) => [...new Set(p.daily.map(d => d.seed))].sort((x, y) => x - y);
    if (a.seeds !== b.seeds || a.days !== b.days || seedsOf(a).length !== a.seeds || JSON.stringify(seedsOf(a)) !== JSON.stringify(seedsOf(b))) throw new Error(`${a.id}种子数、种子集合或天数不一致`);
    for (const p of [a, b]) for (const seed of seedsOf(p)) {
      const days = p.daily.filter(d => d.seed === seed).map(d => d.day).sort((x, y) => x - y);
      if (JSON.stringify(days) !== JSON.stringify(Array.from({ length: p.days }, (_, i) => i + 1))) throw new Error(`${a.id}逐日数据不完整`);
    }
    if (JSON.stringify(a.parameters) !== JSON.stringify(b.parameters)) throw new Error(`${a.id}人设参数不一致`);
    if (JSON.stringify(a.initial) !== JSON.stringify(b.initial)) throw new Error(`${a.id}初始状态不一致`);
    if (b.daily.some(d => !d.budget)) throw new Error(`${a.id}预算排法缺少逐日分配记录`);
    const inputs = (p: PersonaResult) => p.daily.map(d => [d.seed, d.day, d.date, d.baseMinutes, d.availableMinutes])
      .sort((x, y) => Number(x[0]) - Number(y[0]) || Number(x[1]) - Number(y[1]));
    if (JSON.stringify(inputs(a)) !== JSON.stringify(inputs(b))) throw new Error(`${a.id}日期或可用时间随机流不一致`);
  }
  const full = !current.smoke && current.personas.length === PERSONAS.length
    && PERSONAS.every(expected => current.personas.some(p => p.id === expected.id && p.seeds === 20 && p.days === expected.days));
  const lines = ["# 每日时间预算排法与现行排法对比", "",
    full ? "规模：两种排法均完整运行9个人设×20个种子；self/cram/cram-lock各60天，其余各90天，未缩减。"
      : "**规模未达到完整设计：本报告仅使用下列实际样本；人设、种子或模拟天数有缩减，不能据此宣称完整验收。**", "",
    `代码 HEAD：\`${current.gitHead}\`；共同代码指纹：\`${current.sourceHash}\`（一致✅）。`, "",
    `current 排法指纹：\`${current.simulationHash}\`；budget 排法指纹：\`${budget.simulationHash}\`（含 policy，按设计不同）。`, "",
    `冻结库 SHA-256：\`${current.liveHash}\`（一致）。人设、逐日窗口与种子集合一致：${current.personas.map(p => `${p.id}=${p.seeds}`).join("、")}。`, "",
    `合成前史的出厂词库 SHA-256：\`${current.factoryHash}\`（一致）；逐日日期、基准分钟、可用时间随机流、初始状态与标定也逐项一致。`, "",
    "所有数值只含聚合；下表为跨种子中位数 / p90 / 最差。覆盖率和保持率的最差取最低，其余取最高；无事件不填0。",
    "M1最大应做/人设基准的分母是人设当天基准分钟；另列实际可用分钟与推断预算B，三者分别统计。M2交接负荷比的分子是交接当天起15天该题型的最大晨间清单，分母是交接前7天该题型清单的中位数；固定每卡秒数相同，按张数或分钟求比相等。M2不以时间预算作分母。",
    "B仅由近14个有学日的流水×固定秒数推断；近7个有学日完成至少4天时增加10%。人设基准只在本报告作比值，不传入分配器或推断函数。", "",
    "## 模拟口径与边界", "",
    "| 人设 | 起点→目标 | 基准分钟 | 基础缺席率 | 每种子天数 |", "| --- | --- | ---: | ---: | ---: |",
    ...current.personas.map(p => `| ${p.id} | ${p.parameters.start}→${p.parameters.target} | ${n(p.parameters.minutes)} | ${n(p.parameters.absence * 100)}% | ${p.days} |`), "",
    "应用选卡、出勤、可用时间和对错使用分别播种的mulberry32流；两种排法从相同种子重新起步。cram-lock复用cram的随机流，额外钉住单词新学40。出卡数不同会改变应用/对错流的消费位置，因此不是逐张卡共用同一答题结果。",
    "可用时间为基准乘σ=0.3的对数正态噪声；self从冻结库近60个完整日的非零作答分钟分布抽样后再加噪声。office周末休息，break第21–34天强制缺席、第35–37天基准乘0.7。每日用同一个出勤抽样比较基础缺席率和负担反馈概率，后者为min(0.6,基础率+0.15×max(0,前日应做/前日基准−1))。",
    "每卡按固定秒数扣时：单词12、语法25、汉字10、辨析40；重学、减负、压轴也消耗时间。晨间应做只数清单内每卡一次，实做包括重学、教学及当天解锁内容，故实做可能超过晨间应做；下一张放不进剩余时间就停止。",
    "current沿用每5词插一张其它卡的正式混合队列；budget按四类完成比例最落后先出，平手按单词→语法→汉字→辨析。两边评分、FSRS、候选资格、顽固词闸及先验限速仍走正式入口。复习首答概率为R×题型系数×疲劳系数，夹在0.02–0.99；新卡/先验用人设定率，当日重学为0.85。",
    "zero走正式五十音和启蒙词入口；light使用同一份强合成前史（起步前120天分散首学，随后第3/14/45天正式评分答对），不代表真实考后群体。self由冻结历史重放标定，模糊计为想起来但仍按Hard重放；标定R按学习日差，答题阶段仍沿用生产R，二者日界口径有差异。",
    "日终到期积压跨等级统计已开始且未熟知的卡，未验证先验另存，不把尚未放行的先验整批算成欠账。覆盖按绑定目标范围、考期日或最后一天快照统计，含熟知及真实流水；覆盖不是掌握率。未模拟主动续杯、错题集中拿下、速度差异或技能进步。",
    "本次current也在新冻结库和共同标定口径上重跑；11-02历史报告的冻结库已丢失，不能直接与其数字作差。current指上述实验HEAD的正式排法，长跑期间main的后续提交没有混入，也不在本报告的验证范围。合成人设直接从出厂库起步，没有另走self的整套内容迁移；不能把出厂内容的结果外推为完整迁移词库的验收。固定搭配若存在仍由生产独立日额投放，其额外新卡未单建预测曲线；既有卡仅预测首次到期，后续再到期可能被低估。", ""];
  lines.push("### 实现与设计的边界", "",
    "冷启动B用原计划的新学额度×固定秒数折算，没有加上未来多轮复习的稳态用时；安排少→观测作答少→B偏低的反馈仍可能存在，完成日的10%试探不保证能够摆脱。报告同时给出B/人设基准和覆盖、新学代价，不能只凭清单变短判成功。",
    "未锁定普通复习cap只在过载时写回；非过载日保留前日存值，不自动恢复自动档。因此一次收缩可能持续影响后续投放与B推断，这是本次写回约束的结果，尚未验证恢复政策。",
    "28天预测只纳入应用当时已经允许的往上/回补范围，不读取人设脚本预知未来会点哪个按钮。设计§2.3的交接平滑须由实际M2事件证明，窗口长度本身不能证明尚未授权的下一级已被提前预测。",
    "budget绕过saveDailyPlan的0/0段写回副作用，仅保存获准的新学/cap字段；单词cap的0是自动档，不能表示关闭普通复习，分到0时只能保存1。生产入口的这些限制没有在本实验中改动。", "");
  const metricRows = (p: PersonaResult): [string, string][] => {
    const m = p.metrics;
    const runs = [...new Set(p.daily.map(d => d.seed))].map(seed => p.daily.filter(d => d.seed === seed).sort((a, b) => a.day - b.day));
    return [["M1 最大应做/人设基准", s(m.M1.peakToBase, "倍")], ["M1 最大应做/应做中位数", s(m.M1.peakToMedian, "倍")], ["M1 最大应做分钟", s(m.M1.peakMinutes)],
      ["每日应做分钟（每种子日中位数）", s(stats(runs.map(days => median(days.map(d => d.shouldMinutes)))))],
      ["每日实做分钟（有学日中位数）", s(stats(runs.map(days => { const active = days.filter(d => d.actualMinutes > 0); return active.length ? median(active.map(d => d.actualMinutes)) : null; })))],
      ["人设可用分钟（有学日中位数）", s(stats(runs.map(days => { const active = days.filter(d => d.active); return active.length ? median(active.map(d => d.availableMinutes)) : null; })))],
      ["每日应做/可用（可用>0，每种子日中位数）", s(stats(runs.map(days => { const available = days.filter(d => d.availableMinutes > 0); return available.length ? median(available.map(d => d.shouldMinutes / d.availableMinutes)) : null; })), "倍")],
      ["应做超可用天数（可用>0，含缺席日潜在清单）", s(stats(runs.map(days => days.filter(d => d.availableMinutes > 0 && d.shouldMinutes > d.availableMinutes).length)))],
      ["日终到期积压峰值（四类合计）", s(stats(runs.map(days => Math.max(...days.map(d => KINDS.reduce((sum, k) => sum + d.cards[k].backlog, 0))))))],
      ["最后一天到期积压（四类合计）", s(stats(runs.map(days => KINDS.reduce((sum, k) => sum + days[days.length - 1].cards[k].backlog, 0))))],
      ...KINDS.flatMap(k => {
        const retention = stats(runs.map(days => { const count = days.reduce((sum, d) => sum + d.cards[k].review, 0);
          return count ? 100 * days.reduce((sum, d) => sum + d.cards[k].reviewCorrect, 0) / count : null; }), true);
        return [[`${labels[k]}全期新学数（去先验）`, s(stats(runs.map(days => days.reduce((sum, d) => sum + d.cards[k].fresh, 0))))],
          [`${labels[k]}日终到期积压峰值`, s(stats(runs.map(days => Math.max(...days.map(d => d.cards[k].backlog)))))],
          [`${labels[k]}最后一天到期积压`, s(stats(runs.map(days => days[days.length - 1].cards[k].backlog)))],
          [`${labels[k]}跨日复习首答样本数`, s(stats(runs.map(days => days.reduce((sum, d) => sum + d.cards[k].review, 0))))],
          [`${labels[k]}保持率有样本种子数`, `${retention?.samples ?? 0}/${runs.length}`],
          [`${labels[k]}跨日复习首答保持率`, s(retention, "%")]] as [string, string][];
      }),
      ...KINDS.flatMap(k => [[`M2 ${labels[k]}交接观测（事件/完整窗口/有比值种子）`, `${m.M2.events.filter(e => e.kind === k).length} / ${m.M2.events.filter(e => e.kind === k && !e.truncated).length} / ${m.M2.byKind[k].ratio?.samples ?? 0}`],
        [`M2 ${labels[k]}交接负荷比`, s(m.M2.byKind[k].ratio, "倍")],
        [`M2 ${labels[k]}该继续却零新学天数（排除暂停）`, s(m.M2.byKind[k].continuingNoFreshDays)] ] as [string, string][]),
      ["M3 已观察到恢复的最慢日历天", s(m.M3.recoveryDays)], ["M3 未恢复/无基线缺席段数", s(m.M3.unrecovered)], ["M3 回归后最大应做分钟", s(m.M3.returnPeakMinutes)],
      ...KINDS.map(k => [`M4 ${labels[k]}实学覆盖`, s(m.M4.coverage[k], "%")] as [string, string]),
      ["M4 feasible=false天数", s(m.M4.infeasibleDays)], ["M5 生效额度与存值不同天数", s(m.M5.days)],
      ["M5 钉住值被改的天数（存值或生效值）", s(m.M5.lockedChangedDays)], ["M6 因负担多缺天数", s(m.M6.burdenAbsences)]];
  };
  for (const a of current.personas) {
    const b = budget.personas.find(p => p.id === a.id)!;
    lines.push(`## 人设 ${a.id}：${a.name}`, "", `每排法 ${a.seeds} 种子 × ${a.days} 天。`, "",
      "| 指标 | current | budget |", "| --- | --- | --- |");
    const right = new Map(metricRows(b));
    for (const [label, value] of metricRows(a)) lines.push(`| ${label} | ${value} | ${right.get(label)} |`);
    const perSeed = [...new Set(b.daily.map(d => d.seed))].map(seed => b.daily.filter(d => d.seed === seed && d.budget));
    const minutes = stats(perSeed.map(days => days.length ? median(days.map(d => d.budget!.B)) : null));
    const relative = stats(perSeed.map(days => days.length && b.parameters.minutes > 0 ? median(days.map(d => d.budget!.B)) / b.parameters.minutes : null));
    const overloaded = stats(perSeed.map(days => days.filter(d => d.budget!.overloaded).length));
    lines.push(`| B 每种子推断预算的日中位数（分钟） | — | ${s(minutes)} |`,
      `| B 日中位数/人设基准 | — | ${s(relative, "倍")} |`, `| B overloaded天数 | — | ${s(overloaded)} |`);
    for (const [label, field] of [["晨间应做", "shouldMinutes"], ["实做（有学日）", "actualMinutes"]] as const) {
      const relativeToBudget = stats(perSeed.map(days => {
        const observed = days.filter(d => d.budget!.B > 0 && (field !== "actualMinutes" || d.actualMinutes > 0));
        return observed.length ? median(observed.map(d => d[field] / d.budget!.B)) : null;
      }));
      lines.push(`| B 每日${label}/推断预算（日中位数） | — | ${s(relativeToBudget, "倍")} |`);
    }
    lines.push(`| B 晨间应做超推断预算×1.2天数 | — | ${s(stats(perSeed.map(days => days.filter(d => d.shouldMinutes > d.budget!.B * 1.2).length)))} |`, "");
    for (const p of [a, b]) {
      const d = peak(p);
      lines.push(`${p === a ? "current" : "budget"}最重单日：seed ${d.seed}，D${d.day}（${d.date}），应做${n(d.shouldMinutes)}分钟、可用${n(d.availableMinutes)}、实做${n(d.actualMinutes)}；日终积压（单词/语法/汉字/辨析）${KINDS.map(k => d.cards[k].backlog).join(" / ")}。`, "");
    }
  }
  lines.push("## 结果解读", "", "以下比较跨种子中位数；箭头为current→budget，覆盖变化单位为百分点。负担下降和新学减少须一起判断，保持率仅代表被抽到的卡。未观察到交接不能证明交接安全。", "");
  for (const a of current.personas) {
    const b = budget.personas.find(p => p.id === a.id)!;
    const left = new Map(metricRows(a)), right = new Map(metricRows(b));
    const aPeak = a.metrics.M1.peakMinutes?.median, bPeak = b.metrics.M1.peakMinutes?.median;
    const burden = aPeak === undefined || bPeak === undefined ? "峰值未观察" : bPeak < aPeak ? "峰值负担下降" : bPeak > aPeak ? "峰值负担上升" : "峰值负担相同";
    const coverage = KINDS.map(k => {
      const before = a.metrics.M4.coverage[k]?.median, after = b.metrics.M4.coverage[k]?.median;
      return `${labels[k]}${before === undefined || after === undefined ? "未观察" : `${n(before)}%→${n(after)}%（${after >= before ? "+" : ""}${n(after - before)}）`}`;
    });
    const costly = KINDS.filter(k => {
      const before = a.metrics.M4.coverage[k]?.median, after = b.metrics.M4.coverage[k]?.median;
      return before !== undefined && after !== undefined && after < before - 5;
    });
    lines.push(`**${a.id}（${a.name}）：${burden}。** 峰值应做${aPeak === undefined ? "未观察" : n(aPeak)}→${bPeak === undefined ? "未观察" : n(bPeak)}分钟；因负担额外缺席${n(a.metrics.M6.burdenAbsences?.median ?? 0)}→${n(b.metrics.M6.burdenAbsences?.median ?? 0)}天。`, "",
      `覆盖：${coverage.join("；")}。${costly.length ? `${costly.map(k => labels[k]).join("、")}下降超过5个百分点，不能仅凭减负称为整体更好。` : "四类覆盖均未观察到超过5个百分点的下降。"}`, "",
      `新学与积压（中位数 / p90 / 最差）：单词新学${left.get("单词全期新学数（去先验）")}→${right.get("单词全期新学数（去先验）")}；末日四类积压${left.get("最后一天到期积压（四类合计）")}→${right.get("最后一天到期积压（四类合计）")}；单词首答保持率${left.get("单词跨日复习首答保持率")}→${right.get("单词跨日复习首答保持率")}。`, "");
  }
  lines.push("## 验收线", "", "设计稿§3.1要求跨20种子；样本不足、缺人设、未观察到事件或交接窗口不足均标❌，表示尚不能验收。峰值、缺席、覆盖、锁定及先验检查须跑满该人设规定的60/90天；M2须至少20个有效交接种子，相关事件全部具备交接前7天及交接当天起15天的完整窗口。smoke只验证路径，不代替完整验收。", "",
    "| 线 | current | budget | 过没过 |", "| --- | --- | --- | --- |");
  const pair = (id: string) => [current.personas.find(p => p.id === id), budget.personas.find(p => p.id === id)] as const;
  const completePeriod = (p: PersonaResult | undefined) => !budget.smoke && !!p && p.seeds >= 20
    && p.days === PERSONAS.find(expected => expected.id === p.id)?.days;
  const verdicts = { passed: 0, failed: 0, pending: 0 };
  const check = (line: string, a: string, b: string, pass: boolean, sampled: boolean, pending = "样本不足或未观察") => {
    verdicts[!sampled ? "pending" : pass ? "passed" : "failed"]++;
    lines.push(`| ${line} | ${a} | ${b} | ${pass && sampled ? "✅" : `❌${sampled ? "" : `（${pending}，未验收）`}`} |`);
  };
  for (const id of ["office", "break", "struggle"]) {
    const [a, b] = pair(id);
    check(`M1 ${id}最大应做/基准：中位数≤1.3`, s(a?.metrics.M1.peakToBase ?? null), s(b?.metrics.M1.peakToBase ?? null),
      !!b?.metrics.M1.peakToBase && b.metrics.M1.peakToBase.median <= 1.3, completePeriod(b));
  }
  // 即使只跑了smoke，也明确列出全部人设的缺样本项。
  const allIds = ["self", "zero", "cram", "cram-lock", "office", "break", "fast", "struggle", "light"];
  for (const id of allIds) {
    const [a, b] = pair(id);
    check(`M6 ${id}额外缺席：中位数≤1`, s(a?.metrics.M6.burdenAbsences ?? null), s(b?.metrics.M6.burdenAbsences ?? null),
      !!b?.metrics.M6.burdenAbsences && b.metrics.M6.burdenAbsences.median <= 1, completePeriod(b));
  }
  for (const id of allIds) for (const k of KINDS) {
    const [a, b] = pair(id), left = a?.metrics.M2.byKind[k], right = b?.metrics.M2.byKind[k];
    const observed = (key: "ratio" | "continuingNoFreshDays") => {
      const events = b?.metrics.M2.events.filter(e => e.kind === k && (key === "ratio" || e.choice !== "pause")) ?? [];
      return !budget.smoke && (b?.seeds ?? 0) >= 20 && (right?.[key]?.samples ?? 0) >= 20 && events.length > 0
        && events.every(e => e.truncated === false && e.beforeDays >= 7 && e.afterDays >= 15);
    };
    const pending = "样本不足、无有效事件或交接窗口不足";
    check(`M2 ${id}/${labels[k]}交接比：中位数≤1.3、最差≤1.6`, s(left?.ratio ?? null), s(right?.ratio ?? null),
      !!right?.ratio && right.ratio.median <= 1.3 && right.ratio.worst <= 1.6, observed("ratio"), pending);
    check(`M2 ${id}/${labels[k]}继续却零新学：中位数0、最差≤2（排除暂停）`, s(left?.continuingNoFreshDays ?? null), s(right?.continuingNoFreshDays ?? null),
      !!right?.continuingNoFreshDays && right.continuingNoFreshDays.median === 0 && right.continuingNoFreshDays.worst <= 2,
      observed("continuingNoFreshDays"), pending);
  }
  for (const id of ["self", "cram", "fast", "office", "break", "struggle"]) for (const k of KINDS) {
    const [a, b] = pair(id), left = a?.metrics.M4.coverage[k], right = b?.metrics.M4.coverage[k];
    const limited = ["self", "cram", "fast"].includes(id);
    if (!limited && completePeriod(b)) {
      lines.push(`| M4 ${id}/${labels[k]}覆盖：仅报告，不设线 | ${s(left ?? null, "%")} | ${s(right ?? null, "%")} | —（不设验收线） |`);
      continue;
    }
    check(`M4 ${id}/${labels[k]}覆盖：${limited ? "中位数下降≤5个百分点" : "仅报告，不设线"}`, s(left ?? null, "%"), s(right ?? null, "%"),
      !limited || !!left && !!right && right.median >= left.median - 5, completePeriod(b));
  }
  const [selfA, selfB] = pair("self");
  const priorStats = (p: PersonaResult | undefined) => p ? stats([...new Set(p.daily.map(d => d.seed))].map(seed => {
    const values = p.daily.filter(d => d.seed === seed).map(d => d.n4GrammarPriorReleased).filter((v): v is number => v !== undefined);
    return values.length ? Math.max(...values) : null;
  })) : null;
  const pa = priorStats(selfA), pb = priorStats(selfB);
  const priorObserved = (p: PersonaResult | undefined) => completePeriod(p)
    && p!.daily.every(d => Number.isInteger(d.n4GrammarPriorReleased) && d.n4GrammarPriorReleased! >= 0);
  check(`作者本人N4语法先验每日放行≤PRIOR_QUOTA_MAX（${PRIOR_QUOTA_MAX}），沿用现行限速`, s(pa), s(pb),
    !!pa && !!pb && pa.worst <= PRIOR_QUOTA_MAX && pb.worst <= PRIOR_QUOTA_MAX,
    priorObserved(selfA) && priorObserved(selfB), "先验观测未覆盖完整观察期");
  const [lockA, lockB] = pair("cram-lock");
  check("cram-lock 单词新学钉住40：生效/存值不同天数=0", s(lockA?.metrics.M5.lockedChangedDays ?? null), s(lockB?.metrics.M5.lockedChangedDays ?? null),
    !!lockB?.metrics.M5.lockedChangedDays && lockB.metrics.M5.lockedChangedDays.worst === 0,
    completePeriod(lockB) && lockB!.daily.every(d => d.quotas.words.lockedFresh === 40), "锁定观测未覆盖完整观察期");
  lines.push("", `验收小结：数值通过${verdicts.passed}项，数值未达线${verdicts.failed}项，事件/窗口/观察不足而未验收${verdicts.pending}项；仅报告、不设线的覆盖项不计入通过数。`,
    verdicts.failed || verdicts.pending ? "设计验收尚未全部通过；完整运行与算法达标分别判断，不能因分片齐全就建议接入真实排法。" : "本报告列出的设计验收线全部通过；接入真实排法仍须作者决定。");
  lines.push("", "## 运行记录", "",
    `汇总生成时间：current ${current.generatedAt}；budget ${budget.generatedAt}。`, "",
    `已完成种子的子进程累计墙钟：current ${n(current.personas.reduce((sum, p) => sum + p.elapsedSeconds, 0) / 60)}分钟；budget ${n(budget.personas.reduce((sum, p) => sum + p.elapsedSeconds, 0) / 60)}分钟。存在并行，不能相加当作整套实际历时。`, "",
    `跨批次首尾跨度：current ${n((current.runtime?.wallSeconds ?? current.wallSecondsThisCommand) / 60)}分钟；budget ${n((budget.runtime?.wallSeconds ?? budget.wallSecondsThisCommand) / 60)}分钟，包含中断和等待。原始summary及逐种子分片保存在各自的PERSONA_SIM_OUTPUT目录。`);
  lines.push("", "保持率口径：模拟期间以前学过的卡，当天第一次答对数÷当天首答数；按种子汇总，包含正式评分的压轴卡，排除新卡、先验首答与同日重学。它只描述被抽到的卡，不能当作全库记忆率或考试通过率。",
    "局限：已有卡只预测首次到期，不模拟其后续再到期；先验按当前限速外推。未来既有卡/先验/锁定量本身超B时无法凭新学分配消除，overloaded如实记录。平滑下限不能覆盖预算和内容硬约束。",
    "M2仍保留原始noFreshDays；验收另读continuingNoFreshDays，预算收缩到0但仍有需要量的天也计入，选择暂停的事件除外。交接窗口截尾保留原指标标记，短smoke不用于阶段安全结论。", "");
  return lines.join("\n");
}
const labels = { words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析" };
const n = (value: number) => Number(value.toFixed(2)).toString();
const s = (value: Stats | null, suffix = "") => value
  ? `${n(value.median)}${suffix} / ${n(value.p90)}${suffix} / ${n(value.worst)}${suffix}` : "不适用（无事件或分母为0）";
const peak = (p: PersonaResult) => p.daily.reduce((a, b) => a.shouldMinutes > b.shouldMinutes ? a : b);

export function renderReport(summary: Summary): string {
  const cal = summary.calibration, self = summary.personas.find(p => p.id === "self")!;
  const lines = ["# 现行排法的人设负荷基线（本次冻结库重跑）", "",
    `代码基线：\`${summary.gitHead}\`。模拟器指纹：\`${summary.simulationHash}\`。本报告未修改排法。冻结库 SHA-256：\`${summary.liveHash}\`；所有迁移、评分和未来流水仅在内存中。`, "",
    "## 模拟人、标定与边界", "",
    "每个人设、每个种子使用独立的 mulberry32 流：应用随机、出勤、预算、对错分别播种；SQLite RANDOM 与应用 Math.random 都使用应用流，CURRENT_TIMESTAMP 使用模拟时钟。smoke 把两个情景的第1个种子完整重跑并比较 JSON 字节。种子结果不含墙钟耗时；summary 的生成时间和批次耗时是运行元数据。", "",
    "每日预算为基准分钟乘 σ=0.3 的对数正态噪声，秒数向下取整；office 周末、break D21–34 强制缺席，break D35–37 基准乘0.7。随机缺席使用同一个均匀抽样同时判断基础缺席和负担加成，额外缺席只计落在两个概率之间的日期。明日概率=min(0.6, 基础率+0.15×max(0,今日应做/今日基准−1))。固定休息日不重复算基础或负担缺席。", "",
    "单词由真实 stage1 picker 出卡，正式 submitWordAnswer 评分；混合轮换调用 pickMixedNext、answerMixedOther，保留每5词插一张其它卡的生产顺序。减负卡先播，压轴卡在单词计划毕业后出现，均扣12秒；减负不伪造评分流水。每次答题按应用 SECONDS_PER_CARD 固定扣时：单词12、语法25、汉字10、辨析40秒。下一张超过剩余时间就停止，重学也可被时间截断。", "",
    "复习首答 P=clamp(R×题型系数×(1−0.1×min(1,已学分钟/60)),0.02,0.99)，R 读取答前真实 FSRS 状态并调用 retrievability；新卡和先验首答用各自概率，当天重学每步0.85。普通人设的先验首答率统一0.80，这是未给定参数的显式假设。除 self 语法、struggle 每类第一次暂停外，95%提示默认往上；单词与语法分别回答，保持绑定目标不变。", "",
    "zero 的 nextKanaStep → recordKanaAnswer、三日掌握和解锁新词均为应用真实入口。第3个学习日起混简单词，调用 simpleWords / wordMeaningQuestion / recordKanaWordAnswer；轮换只在UI私有的KanaPrimer.pickStep里，模拟器照其30%→80%比例、隔3题、每天最多10词、最多重试1次驱动，不给生产模块加export。掌握后像组件一样调用refreshTodayWordPlan解锁当天新词。教学卡与练习均按12秒；假名首答借用单词首答率、之后0.85，属于未给定概率的近似。五十音未完时仍保留应用允许的其它三类学习。light 前史将目标范围内卡片分散到起步前120天，每张通过正式评分答对4次（间隔3/14/45天），不手写FSRS；这是偏强的合成历史，不代表真实考后人群。构造前史的临时单词cap=1在正式模拟前恢复为默认自动档，D1调用暂不备考与 applyStudyIntensity('light')。", "",
    "初始备考人设使用 saveLevelPlanSettings + applyExamPreset，熟悉度采用应用默认75；self 保留库里的目标、考期、额度与回补状态。所有起推日均为冻结库最后作答日次日，日界Asia/Singapore凌晨4点。人设脚本未指定额外改目标事件；light的暂不备考按指定日执行。", "",
    `### self 标定（${cal.window.begin}–${cal.window.end}，60个完整日）`, "",
    `快照最后作答日 ${cal.lastSnapshotDay}，不把可能尚未结束的那一天用于标定。出勤 ${cal.window.active}/60，缺席 ${cal.window.absent}/60（${n(100 * cal.absence)}%）。每天四类作答次数乘固定秒数后，只在非缺席日的经验分布抽样，再乘相同σ噪声；基准用非零日中位数 ${n(cal.baseMinutes)} 分钟。分布 p10/中位/p90=${n(cal.minuteDistribution.p10)}/${n(cal.minuteDistribution.median)}/${n(cal.minuteDistribution.p90)}，范围 ${n(cal.minuteDistribution.min)}–${n(cal.minuteDistribution.max)} 分钟。没有读历史用时表。`, "",
    "| 题型 | 跨日复习首答样本 | 实际正确率 | 答前平均R | 标定系数 | 新内容首答样本/正确率 | 先验首答样本/正确率 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const k of KINDS) lines.push(`| ${labels[k]} | ${cal.review[k].count} | ${n(100 * (cal.review[k].accuracy ?? 0))}% | ${n(cal.review[k].meanR ?? 0)} | ${n(cal.coefficients[k])} | ${cal.first[k].count} / ${n(100 * cal.firstAccuracy[k])}% | ${cal.prior[k].count} / ${n(100 * (cal.prior[k].accuracy ?? 0))}% |`);
  lines.push("", `self的统一先验首答率=${n(100 * cal.priorAccuracy)}%。${cal.fallbacks.length ? cal.fallbacks.join("；") : "四类首答和复习均有样本。"}`, "",
    `R来源：${cal.method}。四类流水合计重放 ${Object.values(cal.replayed).reduce((a, b) => a + b, 0)} 次；缺失R ${Object.values(cal.missingR).reduce((a, b) => a + b, 0)}。单词校准只认forward（其它方向排除${cal.excludedDirections}条）；预算分布保留全部方向的实际作答工作量。只取每卡每天第一答校准，重复重学不会把正确率抬高。原始表无答前FSRS状态，使用应用recordReview重放；旧单词和语法缺少模式的条数分别为 ${cal.inferredModes.words}、${cal.inferredModes.grammar}，按应用当前历史迁移的首答Easy/顽固规则推断；先验按baseline.updated_at在首次真实作答前生效。它是当前参数下的重建R，无法还原未记录的旧参数、手动覆盖或撤销前状态。间隔分桶聚合也存入summary用于校准敏感性复查。`, "",
    `### self 起步真实聚合状态`, "",
    `目标 ${self.initial.settings.target}，考期 ${self.initial.settings.examDate}，自报起点 ${self.initial.settings.startingLevel}。下表“实学/熟知”只认流水或熟知；“状态覆盖”额外包括尚未验证的先验，不能当作掌握率。`, "",
    "| 等级 | 单词实学/总量 | 单词状态覆盖 | 语法实学/总量 | 语法状态覆盖 |", "| --- | ---: | ---: | ---: | ---: |");
  for (const row of self.initial.levels) lines.push(`| ${row.level} | ${row.words.seen}/${row.words.total}（${n(100 * row.words.seen / row.words.total)}%） | ${n(100 * row.words.stateSeen / row.words.total)}% | ${row.grammar.seen}/${row.grammar.total}（${n(100 * row.grammar.seen / row.grammar.total)}%） | ${n(100 * row.grammar.stateSeen / row.grammar.total)}% |`);
  lines.push("", "| 题型 | 用户存的新学额度 | 用户存的复习上限 | 起步生效新学额度 | 起步生效复习上限 |", "| --- | ---: | ---: | ---: | ---: |");
  for (const k of KINDS) { const q = self.initial.quotas[k]; lines.push(`| ${labels[k]} | ${q.savedFresh} | ${q.savedReview} | ${q.effectiveFresh} | ${q.effectiveReview} |`); }
  lines.push("", "### 指标口径与局限", "",
    "- 表中统一为跨种子“中位数 / p90 / 最差”。覆盖的最差取最小值，其它取最大值；p90总是数值的90分位。无交接/缺席或基线为0记不适用，不填0或无穷。", 
    "- 应做分钟=当天开始真实整份队列的条数×固定秒数（含减负、预选压轴、当日待学假名）。首次看到的整份清单只算每卡一次，事前不知道的重学次数不加在应做上；实做包含重学、教学。假名和启蒙单词按晨间可见资格各计一次，后续教学、当天新解锁内容不回填晨间分母。语法池会在出卡时重新抽样；同一天被排过的并集只用于缺口指标，不膨胀晨间应做数。",
    "- 日终积压为已实学、未熟知、FSRS在学习日结束前到期的条目，含未完成重学；尚未验证先验另列pendingPrior，不把它们一次全倒成积压。积压跨等级全量计，覆盖按绑定目标范围计；上限挡住的到期卡不会消失。",
    "- M1的基准使用当天人设基准（break回归三天为21，office周末没有比值），中位应做包括缺席日的潜在清单。M2按题型，先对每个种子的交接取最大比值/最大零新学天数，再跨种子汇总；完整逐事件也保存，末尾观察不足15天和起步前不足7天均标截尾。",
    "- M3把连续缺席当一个事件，缺席前最多7个日终积压的中位数×1.2为恢复线，从回归日算日历天（当天已恢复=0）。未恢复单列，恢复耗时统计只含观察到恢复的事件；回归峰值观察到模拟终点，会混入以后其它变化，不能单凭它认定缺席的因果。",
    "- M4在考期日或最后一天取快照；实学覆盖不代表掌握、考试得分或通过率。feasible只记录应用提供的计划字段，未运行界面，不能声称用户实际见过提示。该预览部分题型仍使用静态内容差额，可能与真实剩余不一致。",
    "- M5记录生效覆盖层与显式上限政策；0自动/-1不限的解释、没足够到期卡/没新卡的供给不足不算改数。三类自动复习上限调用正式planReviewLimit，原因单列；这不表示持久化用户偏好被写坏。",
    "- 缺席日也生成潜在计划来量工作量：这相当于后台每天看一次计划，会保留未答的新卡任务，不等于用户实际打开了主页。没模拟做题速度差异、题难度、睡眠/技能进步、周内时间相关性、主动续杯/错题集中拿下、词典自选、主动打开备考页触发起点重估和界面误操作。预算是观测工作量的代理，非心理实验。",
    "- 任何卡都可能受0.85重学和固定时间预算设定影响；概率系数是简化统计模型。self只有一个作者，不能外推到群体。light的前史强弱特别影响结论。没有更换FSRS、选词、先验限速或任何生产函数。", "",
    "## 运行记录", "",
    `生成时间 ${summary.generatedAt}；各子进程累计计算墙钟 ${n(summary.personas.reduce((s, p) => s + p.elapsedSeconds, 0) / 60)} 分钟（有并行，不能当成全套墙钟）。有完整计时记录的分片首尾墙钟 ${n((summary.runtime?.wallSeconds ?? summary.wallSecondsThisCommand) / 60)} 分钟，最终汇总命令 ${n(summary.wallSecondsThisCommand / 60)} 分钟。`, "",
    "原始文件为本次PERSONA_SIM_OUTPUT目录中的summary.json；未指定目录时是`frontend/.local/persona-sim/summary.json`。逐日记录按seed/day展开在每个人设的daily数组；每种子交接、恢复、覆盖快照另有完整事件。该目录gitignore，不提交个人聚合数据或冻结库。", "");
  for (const p of summary.personas) {
    const m = p.metrics, maximum = peak(p);
    lines.push(`## 人设 ${p.id}：${p.name}`, "",
      `种子数 ${p.seeds}，每种子 ${p.days} 天。基准 ${n(p.parameters.minutes)} 分钟，基础缺席率 ${n(100 * p.parameters.absence)}%。子进程累计 ${n(p.elapsedSeconds)} 秒。`, "",
      "| 指标 | 中位数 / p90 / 最差 |", "| --- | --- |",
      `| M1 最大应做/人设基准 | ${s(m.M1.peakToBase, "倍")} |`,
      `| M1 最大应做/应做中位数 | ${s(m.M1.peakToMedian, "倍")} |`,
      `| M1 最大应做分钟 | ${s(m.M1.peakMinutes)} |`);
    for (const k of KINDS) lines.push(`| M2 ${labels[k]}交接负荷比 | ${s(m.M2.byKind[k].ratio, "倍")} |`,
      `| M2 ${labels[k]}计划继续却0新学的天数 | ${s(m.M2.byKind[k].noFreshDays)} |`);
    lines.push(`| M3 已观察到恢复的最慢日历天 | ${s(m.M3.recoveryDays)} |`,
      `| M3 未恢复/无基线的缺席段数 | ${s(m.M3.unrecovered)} |`,
      `| M3 回归后最大应做分钟 | ${s(m.M3.returnPeakMinutes)} |`);
    for (const k of KINDS) lines.push(`| M4 ${labels[k]}目标范围实学覆盖 | ${s(m.M4.coverage[k], "%")} |`);
    lines.push(`| M4 feasible=false天数 | ${s(m.M4.infeasibleDays)} |`,
      `| M5 生效额度与存值不同的天数 | ${s(m.M5.days)} |`,
      `| M5 钉住值被改的天数 | ${s(m.M5.lockedChangedDays)} |`,
      `| M6 因负担多缺的天数 | ${s(m.M6.burdenAbsences)} |`, "",
      `最重单日：seed ${maximum.seed}，D${maximum.day}（${maximum.date}），应做 ${n(maximum.shouldMinutes)} 分钟、可用 ${n(maximum.availableMinutes)}、实做 ${n(maximum.actualMinutes)}；日终四类积压 ${KINDS.map(k => maximum.cards[k].backlog).join(" / ")}。`, "",
      `M4评估日：${m.M4.evaluation[0].date}（D${m.M4.evaluation[0].day}，${m.M4.evaluation[0].reason === "examDay" ? "考期日" : "模拟最后一天"}）；提示字段：${m.M4.hint}。`);
    const reasonEntries = Object.entries(m.M5.byReason);
    lines.push(`M5按原因：${reasonEntries.length ? reasonEntries.map(([reason, value]) => `${reason} ${s(value)}`).join("；") : "无"}。`, "");
    if (m.selfGap) lines.push(`N4语法缺口：起步实学/熟知 ${m.selfGap.initiallyLearnedN4} 条，60天一次也未进入真实候选清单 ${s(m.selfGap.neverScheduled)} 条，一次也未显示 ${s(m.selfGap.neverShown)} 条。回补(a)：${[...new Set(m.selfGap.backfill.map(e => e.status))].join("；")}。这是只出到期卡的覆盖缺口，不将未到期自动判为调度错误。`, "");
    const scripted = m.M3.episodes.filter(e => e.scripted);
    if (scripted.length) lines.push(`两周假期单独看：恢复耗时 ${scripted.filter(e => e.days !== null).length}/${scripted.length} 个种子可观察；未恢复 ${scripted.filter(e => e.days === null).length}。D35–37减时也是人设设定，不能全归咎排法。`, "");
    const noFresh = KINDS.map(k => `${labels[k]} ${p.daily.filter(d => d.quotas[k].effectiveFresh > 0 && d.cards[k].fresh === 0).length}/${p.daily.length}`);
    lines.push(`所有日期中，计划仍有新学额度但实际新学0：${noFresh.join("；")}（含缺席、无可学内容，供辨别M2的原因）。`, "");
  }
  const ordered = [...summary.personas].sort((a, b) => (b.metrics.M1.peakToBase?.worst ?? 0) - (a.metrics.M1.peakToBase?.worst ?? 0));
  lines.push("## 现在的排法在哪里出问题", "",
    "以下按观察到的负担严重程度排序。这里给的是现行排法在固定人设下的基线，不从相关性冒称因果；后续新排法应复用同一冻结库、种子、预算和对错规则比较。", "");
  for (const [i, p] of ordered.slice(0, 3).entries()) {
    const d = peak(p), m = p.metrics;
    lines.push(`${i + 1}. **${p.id}的时间可承受性缺口**：seed ${d.seed} D${d.day} 应做${n(d.shouldMinutes)}分钟/基准${n(d.baseMinutes)}分钟，实做${n(d.actualMinutes)}；跨种子峰值/基准${s(m.M1.peakToBase)}，额外缺席${s(m.M6.burdenAbsences)}天。排法的复习上限与固定新学额度没有按当天可用时间收缩，这是机制侧的失配；可用分钟、缺席反馈系数和重学正确率来自模拟设定，峰值大小不能直接当成真人实验结果。`, "");
  }
  lines.push("分界证据：上表M2没有事件时，只能说观察期未跨级，不能声称交接安全；M3未恢复是观察截尾，不是永远恢复不了；M5默认语法上限是现有明确政策，与悄悄写坏用户设置不同。self回补新内容和主动重刷已学N4是两件事，缺口(b)单独量，现有回补按钮只解决前者。", "",
    `量级核对：全体日期的应做中位数 ${n(median(summary.personas.flatMap(p => p.daily.map(d => d.shouldMinutes))))} 分钟。每卡秒数引用应用常数 ${JSON.stringify(SECONDS_PER_CARD)}。`, "");
  return lines.join("\n");
}
