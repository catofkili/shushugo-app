import { rowsFor, studyDate, studyDayEnd, today } from "./study-core";
import { getDailyWordGoal } from "./studyPreferences";
import { ensureFsrsColumns, WORD_FSRS } from "./fsrs-store";

/**
 * 「每日学习数量」：过去每天真的学了多少张，往后一周预计要学多少张。
 *
 * ⚠️ **只数正向（经典模式）那一张卡。反向 / 汉字读音 / 语法都不进这张图。**
 *
 * 原来四档一起数，症状是主页上两个数字当面打架：图说今天 493、经典模式大卡说 320。
 * 差额里有 51 张来自另外三档，而实测那三档根本没人在背 —— 过去 14 天 3,634 卡次里
 * 正向占 **3,583（98.6%）**，语法 29、汉字读音 19、**反向 0**。
 * 也就是说图的左半边本来就已经是 99% 正向；混进来的三档只在「今天」和「预计」
 * 那几根里凭空挂一笔**永远不会还的账**（反向那 15 张到期卡挂了 14 天，一次没动过）。
 * 一张用来看积压的图，把一笔不会动的债天天画给你看，那条线就不再有意义。
 *
 * 代价说清楚：**那三档的积压从此在主页上看不见了。** 它们各自的入口
 * （汉字读音模式、语法考题）里还有自己的数，这张图不再替它们说话。
 * 哪天真开始认真背反向了，把它加回 forecastDue/pendingDue 就行，但**别顺手加回过去那一段** ——
 * 那会让历史柱子一夜之间长高，看着像是那几天多学了。
 *
 * ⚠️ **改成只数正向之后，「今天」那根仍然不等于大卡上的数**（实测 442 vs 320）。
 * 剩下的差额是顽固词闸门：正向到期 412 张里有 149 张是 lapses≥8 的顽固词，
 * 而当日计划每天只放 `LEECH_DAILY_INTAKE`(10) 个进去。**这条差额是故意留着的**，
 * 理由和下面那条「不套复习上限」一样 —— 见本文件末尾那段。
 *
 * 同一天同一张卡答十次仍然只算一张：那十次是学习步骤在反复确认同一件事，不是学了十个东西。
 *
 * ⚠️ **左边是发生过的事，右边是排出来的账，两种东西**：
 *   - 过去那些从 `reviews` / `grammar_reviews` 数，是既成事实；
 *   - 未来那些是 FSRS 现在排好的 due 落在哪一天 + 每天的新词额度，
 *     **这是个下限**：今天答错的卡会在几天内回来，那部分还没发生，排不进去。
 *     所以真实值只会比预计的高，别把这条曲线当承诺。
 *
 * 也**没有**把复习上限（dailyReviewCap）套进预计值：那是「今天最多给你排多少」，
 * 套上去会把积压藏起来，而这张图正是用来看积压有没有在变小的。
 */

/** 一根柱子 */
export interface DailyLoadBar {
  /** 学习日 YYYY-MM-DD（凌晨四点换日，和全局一致） */
  date: string;
  /** 新学：这张卡第一次露面。未来那几天是「新词额度」 */
  fresh: number;
  /** 复习：以前学过、今天又见到。未来那几天是「到期量」 */
  review: number;
  /**
   * 只有「今天」那根有：今天**还没做**的量（到期的 + 新词额度还没发完的）。
   *
   * 没有这一截的话，早上打开就是一根 0 —— 明明今天有三百张要背，图上却是个空洞，
   * 而它右边的预计柱子还都是满的。实心那截是做了的，这一截是还欠的。
   */
  pending: number;
  /** 这根是排出来的账，不是发生过的事 */
  forecast: boolean;
  /** 就是今天那根（还在进行中） */
  today: boolean;
}

export interface DailyLoad {
  bars: DailyLoadBar[];
  /** 过去的日均（**不含今天** —— 今天才过了一半，算进去会把平均线拉下来） */
  pastAverage: number;
  /** 预计的日均 */
  forecastAverage: number;
}

const DEFAULT_PAST_DAYS = 14;
const DEFAULT_FUTURE_DAYS = 7;

const shiftDay = (day: string, delta: number): string => {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return studyDate(date);
};

/** 这张图只看正向那一张卡（progress）。为什么不是四张，见文件顶部。 */
const FORECAST_ENTITY = WORD_FSRS;

/** 过去每天答过几张卡、其中几张是第一次露面 */
const pastCounts = (firstDay: string, lastDay: string) => {
  const byDay = new Map<string, { cards: number; fresh: number }>();
  const bump = (day: string, key: "cards" | "fresh", value: number) => {
    if (!day) return;
    const entry = byDay.get(day) ?? { cards: 0, fresh: 0 };
    entry[key] += value;
    byDay.set(day, entry);
  };

  // 同一天同一个词答十次也只算一张 —— 那十次是学习步骤在反复确认同一件事，
  // 不是学了十个东西。
  //
  // ⚠️ `direction = 'forward'` 这个条件是这张图的口径本身，不是顺手加的过滤。
  // 老库里还躺着 `direction = 'kanji'` 的历史流水（那是已经废掉的「释义→汉字」写法题），
  // 不卡方向的话它们会混进正向的柱子里。
  rowsFor(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS cards
    FROM reviews
    WHERE direction = 'forward' AND reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `, [firstDay, lastDay]).forEach((row) => bump(String(row.reviewed_on ?? ""), "cards", Number(row.cards ?? 0)));

  // 「第一次露面」= 这张卡有史以来最早的那个学习日就是这天。整表 GROUP BY 一次，
  // 比逐行 NOT EXISTS 快得多（实测三万多条流水几十毫秒）。
  //
  // ⚠️ 方向过滤必须写在**子查询里面**：写到外面的话 MIN() 会算上反向/汉字的日期，
  // 一个词要是先背过反向，它的正向首答就会被算成「不是第一次」，那天的新学凭空少一个。
  rowsFor(`
    SELECT reviewed_on, COUNT(*) AS fresh
    FROM (
      SELECT word_id, MIN(reviewed_on) AS reviewed_on
      FROM reviews
      WHERE direction = 'forward'
      GROUP BY word_id
    )
    WHERE reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `, [firstDay, lastDay]).forEach((row) => bump(String(row.reviewed_on ?? ""), "fresh", Number(row.fresh ?? 0)));

  return byDay;
};

/**
 * 未来 n 个学习日各自到期几张。
 *
 * 分桶在 JS 里做，不在 SQL 里 —— fsrs_due 存的是 UTC 时刻，而学习日的边界是
 * **本地时间凌晨四点**，SQL 里的 date() 切出来是 UTC 日，差几个小时的卡会记错天。
 * 边界用 studyDayEnd 逐天推出来，两边用的是同一把尺子。
 */
const forecastDue = (dayCount: number, now: Date): number[] => {
  const buckets = new Array(dayCount).fill(0);
  if (dayCount <= 0) return buckets;
  const bounds: number[] = [];
  const end = studyDayEnd(now);
  for (let i = 0; i <= dayCount; i += 1) {
    const at = new Date(end);
    at.setDate(at.getDate() + i);
    bounds.push(at.getTime());
  }
  const from = new Date(bounds[0]).toISOString();
  const to = new Date(bounds[dayCount]).toISOString();

  ensureFsrsColumns(FORECAST_ENTITY);
  rowsFor(`
    SELECT fsrs_due FROM ${FORECAST_ENTITY.table}
    WHERE ${FORECAST_ENTITY.eligible} AND fsrs_due >= ? AND fsrs_due < ?
  `, [from, to]).forEach((row) => {
    const at = new Date(String(row.fsrs_due ?? "")).getTime();
    if (!Number.isFinite(at)) return;
    // bounds[i] 是第 i 天的开始，bounds[i+1] 是结束
    let index = 0;
    while (index < dayCount - 1 && at >= bounds[index + 1]) index += 1;
    buckets[index] += 1;
  });
  return buckets;
};

/**
 * 今天还欠着的复习量：本学习日内仍到期的卡。
 *
 * 今天已经答完并毕业的卡 due 已经排到明天以后，自然就不在里面了 ——
 * 不需要再去减「今天做了多少」，那样会把当天重刷的卡重复扣掉。
 */
const pendingDue = (now: Date): number => {
  const end = studyDayEnd(now).toISOString();
  ensureFsrsColumns(FORECAST_ENTITY);
  return Number(rowsFor(`
    SELECT COUNT(*) AS n FROM ${FORECAST_ENTITY.table}
    WHERE ${FORECAST_ENTITY.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
  `, [end])[0]?.n ?? 0);
};

/** 还没学过的词还剩多少 —— 新词额度只能发到它见底为止 */
const unlearnedWordCount = (): number => Number(rowsFor(`
  SELECT COUNT(*) AS n FROM progress WHERE known_forever = 0 AND seen_count = 0
`)[0]?.n ?? 0);

export const dailyStudyLoad = (options: {
  pastDays?: number;
  futureDays?: number;
  now?: Date;
} = {}): DailyLoad => {
  const now = options.now ?? new Date();
  const pastDays = Math.max(options.pastDays ?? DEFAULT_PAST_DAYS, 1);
  const futureDays = Math.max(options.futureDays ?? DEFAULT_FUTURE_DAYS, 0);
  const day = today(now);
  const firstDay = shiftDay(day, -(pastDays - 1));

  const counts = pastCounts(firstDay, day);
  const bars: DailyLoadBar[] = [];
  for (let i = pastDays - 1; i >= 0; i -= 1) {
    const date = shiftDay(day, -i);
    const entry = counts.get(date) ?? { cards: 0, fresh: 0 };
    bars.push({
      date,
      fresh: entry.fresh,
      review: Math.max(entry.cards - entry.fresh, 0),
      pending: 0,
      forecast: false,
      today: i === 0
    });
  }

  const goal = Math.max(getDailyWordGoal(), 0);
  let unlearned = unlearnedWordCount();
  const todayBar = bars[bars.length - 1];
  if (todayBar?.today) {
    const freshLeft = Math.min(Math.max(goal - todayBar.fresh, 0), unlearned);
    todayBar.pending = pendingDue(now) + freshLeft;
    // 今天还要发的这些新词不能再算进明天的额度里，否则总量凭空多出一天
    unlearned -= freshLeft;
  }

  const due = forecastDue(futureDays, now);
  // 新词额度每天照发，直到没学过的词发完为止。**不按剩余量打折**：
  // 额度的含义是「今天要学这么多新词」，不是「新词占计划的百分之几」。
  for (let i = 0; i < futureDays; i += 1) {
    const fresh = Math.min(goal, unlearned);
    unlearned -= fresh;
    bars.push({
      date: shiftDay(day, i + 1),
      fresh,
      review: due[i] ?? 0,
      pending: 0,
      forecast: true,
      today: false
    });
  }

  const total = (bar: DailyLoadBar) => bar.fresh + bar.review + bar.pending;
  // 今天不进平均：它才过了一半，算进去就是拿半天的量去拉低「过去每天学多少」。
  const settled = bars.filter((bar) => !bar.forecast && !bar.today);
  const forecasts = bars.filter((bar) => bar.forecast);
  const mean = (list: DailyLoadBar[]) =>
    list.length ? Math.round(list.reduce((sum, bar) => sum + total(bar), 0) / list.length) : 0;

  return { bars, pastAverage: mean(settled), forecastAverage: mean(forecasts) };
};
