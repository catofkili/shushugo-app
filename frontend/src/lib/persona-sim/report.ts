import type { LevelPlanSettings } from "../level-plan";
import { SECONDS_PER_CARD } from "../daily-plan";
import { KINDS, median, type Daily, type Persona, type Quota, type Stats, type metricsFor } from "./model";
import type { Calibration } from "./calibration";

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
}
const labels = { words: "单词", grammar: "语法", kanji: "汉字", confusion: "辨析" };
const n = (value: number) => Number(value.toFixed(2)).toString();
const s = (value: Stats | null, suffix = "") => value
  ? `${n(value.median)}${suffix} / ${n(value.p90)}${suffix} / ${n(value.worst)}${suffix}` : "不适用（无事件或分母为0）";
const peak = (p: PersonaResult) => p.daily.reduce((a, b) => a.shouldMinutes > b.shouldMinutes ? a : b);

export function renderReport(summary: Summary): string {
  const cal = summary.calibration, self = summary.personas.find(p => p.id === "self")!;
  const lines = ["# 现行排法的人设负荷基线（2026-11-02）", "",
    `代码基线：\`${summary.gitHead}\`。模拟器指纹：\`${summary.simulationHash}\`。本报告未修改排法。冻结库 SHA-256：\`${summary.liveHash}\`；所有迁移、评分和未来流水仅在内存中。`, "",
    "## 模拟人、标定与边界", "",
    "每个人设、每个种子使用独立的 mulberry32 流：应用随机、出勤、预算、对错分别播种；SQLite RANDOM 与应用 Math.random 都使用应用流，CURRENT_TIMESTAMP 使用模拟时钟。smoke 把两个情景的第1个种子完整重跑并比较 JSON 字节。种子结果不含墙钟耗时；summary 的生成时间和批次耗时是运行元数据。", "",
    "每日预算为基准分钟乘 σ=0.3 的对数正态噪声，秒数向下取整；office 周末、break D21–34 强制缺席，break D35–37 基准乘0.7。随机缺席使用同一个均匀抽样同时判断基础缺席和负担加成，额外缺席只计落在两个概率之间的日期。明日概率=min(0.6, 基础率+0.15×max(0,今日应做/今日基准−1))。固定休息日不重复算基础或负担缺席。", "",
    "单词由真实 stage1 picker 出卡，正式 submitWordAnswer 评分；混合轮换调用 pickMixedNext、answerMixedOther，保留每5词插一张其它卡的生产顺序。减负卡先播，压轴卡在单词计划毕业后出现，均扣12秒；减负不伪造评分流水。每次答题按应用 SECONDS_PER_CARD 固定扣时：单词12、语法25、汉字10、辨析40秒。下一张超过剩余时间就停止，重学也可被时间截断。", "",
    "复习首答 P=clamp(R×题型系数×(1−0.1×min(1,已学分钟/60)),0.02,0.99)，R 读取答前真实 FSRS 状态并调用 retrievability；新卡和先验首答用各自概率，当天重学每步0.85。普通人设的先验首答率统一0.80，这是未给定参数的显式假设。除 self 语法、struggle 每类第一次暂停外，95%提示默认往上；单词与语法分别回答，保持绑定目标不变。", "",
    "zero 的 nextKanaStep → recordKanaAnswer、三日掌握和解锁新词均为应用真实入口。第3个学习日起混简单词，调用 simpleWords / wordMeaningQuestion / recordKanaWordAnswer；轮换只在UI私有的KanaPrimer.pickStep里，模拟器照其30%→80%比例、隔3题、每天最多10词、最多重试1次驱动，不给生产模块加export。掌握后像组件一样调用refreshTodayWordPlan解锁当天新词。教学卡与练习均按12秒；假名首答借用单词首答率、之后0.85，属于未给定概率的近似。五十音未完时仍保留应用允许的其它三类学习。light 前史将目标范围内卡片分散到起步前120天，每张通过正式评分答对4次（间隔3/14/45天），不手写FSRS；这是偏强的合成历史，不代表真实考后人群。构造前史的临时单词cap=1在正式模拟前恢复为默认自动档，D1调用暂不备考与 applyStudyIntensity('light')。", "",
    "初始备考人设使用 saveLevelPlanSettings + applyExamPreset，熟悉度采用应用默认75；self 保留库里的目标、考期、额度与回补状态。所有起推日均为冻结库最后作答日次日，日界Asia/Singapore凌晨4点。没有额外改目标事件，因为八个人设脚本没有指定此类事件；light的暂不备考按指定日执行。", "",
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
    "- M5记录生效覆盖层与显式上限政策；0自动/-1不限的解释、没足够到期卡/没新卡的供给不足不算改数。语法默认60单列为隐式政策；这不表示持久化用户偏好被写坏。",
    "- 缺席日也生成潜在计划来量工作量：这相当于后台每天看一次计划，会保留未答的新卡任务，不等于用户实际打开了主页。没模拟做题速度差异、题难度、睡眠/技能进步、周内时间相关性、主动续杯/错题集中拿下、词典自选、主动打开备考页触发起点重估和界面误操作。预算是观测工作量的代理，非心理实验。",
    "- 任何卡都可能受0.85重学和固定时间预算设定影响；概率系数是简化统计模型。self只有一个作者，不能外推到群体。light的前史强弱特别影响结论。没有更换FSRS、选词、先验限速或任何生产函数。", "",
    "## 运行记录", "",
    `生成时间 ${summary.generatedAt}；各子进程累计计算墙钟 ${n(summary.personas.reduce((s, p) => s + p.elapsedSeconds, 0) / 60)} 分钟（有并行，不能当成全套墙钟）。有完整计时记录的分片首尾墙钟 ${n((summary.runtime?.wallSeconds ?? summary.wallSecondsThisCommand) / 60)} 分钟，最终汇总命令 ${n(summary.wallSecondsThisCommand / 60)} 分钟。`, "",
    "原始文件：`frontend/.local/persona-sim/summary.json`。逐日记录按seed/day展开在每个人设的daily数组；每种子交接、恢复、覆盖快照另有完整事件。该目录gitignore，不提交个人聚合数据或冻结库。", "");
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
