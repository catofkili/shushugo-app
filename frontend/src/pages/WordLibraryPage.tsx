import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, Star, X } from "lucide-react";
import {
  DEFAULT_LIBRARY_FILTERS,
  MEMORY_BANDS,
  POS_BUCKETS,
  bandMeta,
  queryWordLibrary,
  tallyWordLibrary,
  wordLibraryDetail,
  wordLibraryIds,
  type LibraryBandFilter,
  type LibraryLevel,
  type LibrarySort,
  type WordLibraryDetail,
  type WordLibraryFilters,
  type WordLibraryRow
} from "../lib/word-library";
import { useRowSelection } from "../hooks/useRowSelection";
import { displayForm } from "../lib/confusion-groups";
import {
  addWordsToQueue,
  markWordKnownForever,
  setWordsKnownForeverIds,
  toggleFavorite,
  unmarkWordKnownForever,
  updateWordNote
} from "../lib/api";

/**
 * 词库 / 选词页。
 *
 * 一条词一行，右边的色条说的是「还能记多久」（FSRS stability），不是今天该不该复习——
 * 到期与顽固另用角标标出来。颜色若跟排期挂钩，同一个词今天红明天绿，
 * 翻词库看到的就成了排期而不是记忆。
 *
 * 点开是**只读**详情：不评分、不进 FSRS。
 *
 * 队列只有一份（progress 里的 FSRS 状态），「今天」是它在学习日边界上的投影，
 * 所以**只有没学过的词才谈得上「加入队列」** —— 学过的到期自己会出现，加了没有含义。
 *
 * 这一页能改数据的只有三件，都不碰 FSRS 的记忆状态：加入队列、熟知（行末那颗和
 * 多选工具条上那颗是同一条实现）、收藏/笔记。**评分永远不在这里发生。**
 */

const LEVELS: { id: LibraryLevel; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "N5", label: "N5" },
  { id: "N4", label: "N4" },
  { id: "N3", label: "N3" },
  { id: "N2", label: "N2" },
  { id: "N1", label: "N1" },
  { id: "unranked", label: "未分级" }
];

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "level", label: "按等级" },
  { id: "weakest", label: "最弱在前" },
  { id: "recent", label: "最近学过" },
  { id: "kana", label: "五十音" }
];

const PAGE_SIZE = 100;
/** 「全选」一次最多勾这么多，免得手一抖把整个 N1 塞进今天 */
const SELECT_ALL_CAP = 300;

/** 普通提示挂多久 */
const NOTICE_MS = 2600;
/** 带撤销的挂多久:得留出「看见 → 意识到点错了 → 抬手够到」的时间 */
const NOTICE_UNDO_MS = 6000;

/** 找到真正在滚的那个祖先：外层 <main> 是 fixed + overflow:auto，window 根本不滚。 */
const scrollParent = (node: HTMLElement | null): HTMLElement | null => {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflow = window.getComputedStyle(current).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
};

/**
 * 一行要显示的词形。
 *
 * 外来語行的 `kanji` 存的是**词源**（camera / apartment house / gram；(法) gramme），
 * 照着 `kanji || kana` 摆大字，学日语的人满屏看到的是英文。片假名永远是主词形，
 * 词源退到小字那一行。口径同 `confusion-groups` 的 `displayForm` 和学习页的
 * `isLoanwordSourceCard` —— 别再写第四套。用户库里 835 个词（7.5%）走这条。
 */
const wordForms = (row: { kanji: string; kana: string }) => {
  const primary = displayForm(row);
  // 词源可能是「gram；(法) gramme」这种多语并列，小字只摆第一个
  const source = /[A-Za-z]/.test(row.kanji) ? row.kanji.split(/[；;]/)[0].trim() : "";
  return { primary, secondary: primary === row.kana ? source : row.kana };
};

const dayDiff = (iso: string): number => {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.round((target - Date.now()) / 86400000);
};

/** 右侧那行小字：这个词现在是什么处境 */
const statusText = (row: WordLibraryRow): string => {
  if (row.band === "unseen") return "未学";
  if (row.band === "mastered") return "已掌握";
  if (row.isDue) {
    if (!row.dueAt) return "该复习了";
    const days = dayDiff(row.dueAt);
    return days < -1 ? `过期 ${-days} 天` : "该复习了";
  }
  if (!row.dueAt) return bandMeta(row.band).label;
  const days = dayDiff(row.dueAt);
  if (days <= 0) return "该复习了";
  if (days === 1) return "明天复习";
  if (days < 30) return `${days} 天后复习`;
  const months = Math.round(days / 30);
  return `约 ${months} 个月后`;
};

interface WordLibraryPageProps {
  initialLevel?: LibraryLevel;
  /** 勾一批词直接开一场只含这些词的学习（不进今日计划） */
  onStudyPicked?: (wordIds: number[]) => void;
}

export function WordLibraryPage({ initialLevel = "all", onStudyPicked }: WordLibraryPageProps) {
  const [filters, setFilters] = useState<WordLibraryFilters>({ ...DEFAULT_LIBRARY_FILTERS, level: initialLevel });
  const [searchInput, setSearchInput] = useState("");
  const [rows, setRows] = useState<WordLibraryRow[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  /**
   * 底部小提示。带 action 的那种是**撤销条**:直接把事做掉,把后悔药挂在这里,
   * 而不是事前弹一个确认框。
   *
   * 确认框对每一个人、每一次都收税,而点到第三次「删除 → 确定」就变成一个动作的
   * 肌肉记忆了 —— 真正手滑那次照样两连击点过去。撤销刚好反过来:99 次零成本,
   * 那 1 次真出事的时候后悔药还在屏幕上挂着。
   *
   * 留确认框的判据只有三条:真不可逆 / 已经发出去了 / 一辈子点不到三次。
   * 「标熟知」一条都不占(它的反向操作就是同一个函数),所以它不配有确认框。
   */
  const [notice, setNotice] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const showNotice = (text: string, action?: { label: string; run: () => void }) => setNotice({ text, action });
  const [filterOpen, setFilterOpen] = useState(false);
  /** 改了单独一行之后重算分布带用的；列表本身只改那一行，不整段重取 */
  const [revision, setRevision] = useState(0);

  // 选词的手感和快速学习完全一样：长按任意一行进选择模式，按住往下划一路选过去。
  // 同一份实现（hooks/useRowSelection），别在这儿再写一遍。
  const selection = useRowSelection({
    rowSelector: ".wl-row[data-word-id]",
    idKey: "wordId",
    scrollContainer: () => scrollParent(pageRef.current),
    onEnter: () => setOpenId(null)
  });
  const picking = selection.selectionMode;
  const selected = selection.selectedIds;
  const pageRef = useRef<HTMLElement | null>(null);
  /** 一页还没落地就别再取下一页 */
  const loadingRef = useRef(false);
  /** 已经取到第几条。必须是 ref 不是 rows.length：同一个 tick 里连着触发两次时，
      rows 还没提交，用 rows.length 会拿同一个 offset 再查一遍 —— 表现为整页词重复。 */
  const offsetRef = useRef(0);

  // 搜索防抖：每敲一个字都跑一遍全表 LIKE 会顿
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === searchInput ? current : { ...current, search: searchInput }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 换筛选等于换了一份列表：还停在上一份的第 800 行会莫名其妙地看到「到底了」。
  // 滚动容器是外层的 <main>，不是 window。
  useEffect(() => {
    const scroller = scrollParent(pageRef.current);
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo(0, 0);
  }, [filters]);

  const tally = useMemo(() => {
    // revision 只是个失效令牌：tallyWordLibrary 读的是数据库，改了某一行之后要重算，
    // 但它不作为参数出现，所以在这里显式引用一下，免得被当成多余依赖删掉。
    void revision;
    return tallyWordLibrary(filters);
  }, [filters, revision]);

  useEffect(() => {
    const first = queryWordLibrary(filters, 0, PAGE_SIZE);
    loadingRef.current = false;
    offsetRef.current = first.length;
    setRows(first);
    setHasMore(first.length === PAGE_SIZE);
  }, [filters]);

  // 取下一页。注意别把查询塞进 setRows 的 updater 里：updater 必须是纯函数，
  // 在里面再 setState 会在渲染期间改状态，开发模式的双调用下这一页会静默地不加载。
  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const next = queryWordLibrary(filters, offsetRef.current, PAGE_SIZE);
    offsetRef.current += next.length;
    setRows((current) => [...current, ...next]);
    setHasMore(next.length === PAGE_SIZE);
  }, [filters]);

  useEffect(() => {
    loadingRef.current = false;
  }, [rows]);

  // 触底续页，一路自动，没有「加载到多少就改手动」这种封顶 ——
  // 那等于把懒加载退化成分页器。DOM 的重量交给 CSS 的 content-visibility 扛。
  //
  // 用滚动事件而不是 IntersectionObserver：IO 在页面不可见时一律报「没相交」，
  // 后台标签页/WebView 挂起回来就再也不续了。
  useEffect(() => {
    if (!hasMore) return;
    const scroller = scrollParent(pageRef.current);
    const check = () => {
      const remaining = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        : document.body.offsetHeight - window.scrollY - window.innerHeight;
      // 提前一屏半开始取，让下一页在滚到底之前就位
      if (remaining < 900) loadMore();
    };
    // 不加 rAF 之类的节流：check 只读三个属性，而 rAF 在页面不可见时根本不触发，
    // 拿它当闸门等于给「滚动了却不续页」留一条静默失效的路。重复取页由 loadingRef 挡。
    check();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", check, { passive: true });
    return () => target.removeEventListener("scroll", check);
    // rows.length 进依赖：刚续上的一页还没填满屏幕时，要再查一次
  }, [hasMore, loadMore, rows.length]);

  useEffect(() => {
    if (!notice) return;
    // 撤销条要挂得久一点:得留出「看见 → 意识到点错了 → 抬手够到」的时间。
    const timer = window.setTimeout(() => setNotice(null), notice.action ? NOTICE_UNDO_MS : NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patch = (next: Partial<WordLibraryFilters>) => setFilters((current) => ({ ...current, ...next }));

  const toggleBand = (band: LibraryBandFilter) =>
    patch({ band: filters.band === band ? "all" : band });

  const exitPicking = () => selection.exit();

  /**
   * 快捷选择：按当前筛选整批勾上。
   *
   * 一万行的列表里逐个点是不可能的，长按划选也只解决「屏幕上这十几行」；
   * 真正常用的是「把该复习的全勾上」「把这一级没学的全勾上」这种按条件选。
   * 走的是同一条 SQL（`wordLibraryIds`），所以勾中的就是列表里能看到的那些。
   */
  const quickPick = (patch: Partial<WordLibraryFilters>, label: string) => {
    const ids = wordLibraryIds({ ...filters, ...patch }, SELECT_ALL_CAP);
    if (!ids.length) {
      showNotice(`${label}：没有符合的词`);
      return;
    }
    selection.setSelectedIds(new Set(ids));
    showNotice(ids.length >= SELECT_ALL_CAP
      ? `${label}：已勾选前 ${SELECT_ALL_CAP} 条（单次上限）`
      : `${label}：已勾选 ${ids.length} 条`);
  };

  /**
   * 批量操作之后整段重取,**保留用户滚到的位置和已加载的行数**。
   *
   * ⚠️ 这里以前最后一句是 `setFilters((current) => ({ ...current }))` —— 只是想让
   * 上面那个 tally 重算,却顺手换掉了 filters 的对象引用。而挂在 `[filters]` 上的
   * 两个 effect 的语义是「换了一份列表」:一个把滚动条拉回顶部,一个把 rows 砍回
   * 第一页 100 行。结果就是滚到第 800 行标一批熟知,整个列表弹回开头。
   *
   * tally 的失效走 `revision`(它本来就是为这件事准备的令牌,refreshOne 用的也是它),
   * 不要再动 filters —— filters 变了就等于用户换了筛选条件,回顶部是对的。
   */
  const refreshRows = () => {
    const size = Math.max(rows.length, PAGE_SIZE);
    const fresh = queryWordLibrary(filters, 0, size);
    offsetRef.current = fresh.length;
    setRows(fresh);
    // 标了一批熟知之后行数可能变少(比如筛的是「未学」),取不满就是真到底了
    setHasMore(fresh.length === size);
    setRevision((value) => value + 1);
  };

  const queueWords = (ids: number[]) => {
    const { added, today, alreadyLearning, known } = addWordsToQueue(ids);
    const parts: string[] = [];
    if (added > 0) {
      parts.push(
        today >= added ? `已加入队列 ${added} 个新词，今天就出`
          : today > 0 ? `已加入队列 ${added} 个新词，今天先出 ${today} 个，其余排在后面几天`
            : `已加入队列 ${added} 个新词，今天的新词已经学完了，明天开始出`
      );
    }
    if (alreadyLearning > 0) parts.push(`${alreadyLearning} 个学过的不用加，到期会自己出现`);
    if (known > 0) parts.push(`${known} 个标了熟知`);
    showNotice(parts.join("；") || "没有可加的词");
    refreshRows();
  };

  /** 只重取这一行。已经加载了几千行的时候，为一次点击整段重查是白烧 */
  const refreshOne = (wordId: number) => {
    const fresh = wordLibraryDetail(wordId);
    if (fresh) setRows((current) => current.map((row) => (row.id === wordId ? fresh : row)));
    setRevision((value) => value + 1);
  };

  /**
   * 行末那颗「熟知」。
   *
   * 点一下 = 这个词进队列、第一次出现就答了「熟知」：算一次学过，然后退出 FSRS 队列，
   * 正常复习里几乎不会再出现。再点一下撤销（当天点的连那条流水一起撤，别让点错留下假记录）。
   */
  const toggleKnown = (row: WordLibraryRow) => {
    if (row.isKnownForever) {
      unmarkWordKnownForever(row.id);
      showNotice(`${wordForms(row).primary} 放回复习队列`);
    } else {
      markWordKnownForever(row.id);
      showNotice(`${wordForms(row).primary} 记为熟知，算一次学过，之后不再出现`);
    }
    refreshOne(row.id);
  };

  const handleAddToQueue = () => {
    queueWords([...selected]);
    exitPicking();
  };

  const handleMarkKnown = (known: boolean) => {
    // 撤销按「真的改动了哪些」回滚,不是按原始勾选反着跑 —— 见 setWordsKnownForeverIds
    const changed = setWordsKnownForeverIds([...selected], known);
    exitPicking();
    refreshRows();
    if (!changed.length) {
      showNotice(known ? "勾中的词都已经是熟知了" : "勾中的词都在复习队列里");
      return;
    }
    showNotice(
      known ? `已把 ${changed.length} 个词标为熟知` : `已把 ${changed.length} 个词放回复习`,
      {
        label: "撤销",
        run: () => {
          setWordsKnownForeverIds(changed, !known);
          refreshRows();
          showNotice(known ? `已撤销，${changed.length} 个词回到复习队列` : `已撤销，${changed.length} 个词回到熟知`);
        }
      }
    );
  };

  const bandLegend = MEMORY_BANDS.filter((item) => tally.bands[item.id] > 0);
  // 「加入队列」只对没学过的词有意义。勾中的词里一个未学的都没有就把按钮灰掉，
  //（全选可能勾到还没加载出来的行，那些当未知，不拦）
  const queueable = useMemo(() => {
    const bandById = new Map(rows.map((row) => [row.id, row.band]));
    let unseen = 0;
    let unknown = 0;
    selected.forEach((id) => {
      const band = bandById.get(id);
      if (band === undefined) unknown += 1;
      else if (band === "unseen") unseen += 1;
    });
    return unseen + unknown;
  }, [rows, selected]);
  // 分布带只画**学过的**词：未学占了八成，混进去的话彩色部分会被压成一条看不见的线，
  // 而这条带子要回答的是「我学过的这些，牢到什么程度」。未学仍留在图例里可点。
  const studiedLegend = bandLegend.filter((item) => item.id !== "unseen");
  const studiedTotal = studiedLegend.reduce((sum, item) => sum + tally.bands[item.id], 0);

  return (
    <section className="wl-page" ref={pageRef}>
      <header className="wl-head">
        <div>
          <p className="wl-kick">Vocabulary</p>
          <h1 className="wl-title">
            {filters.level === "all" ? "词库" : filters.level === "unranked" ? "未分级词库" : `${filters.level} 词库`}
          </h1>
        </div>
        <p className="wl-count">
          <b>{tally.total}</b> 词 · 到期 {tally.due} · 顽固 {tally.leech}
        </p>
      </header>

      <label className="wl-search">
        <Search size={15} />
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜汉字、假名或释义"
          inputMode="search"
        />
        {searchInput && (
          <button onClick={() => setSearchInput("")} aria-label="清空">
            <X size={14} />
          </button>
        )}
      </label>

      <div className="wl-chips">
        {LEVELS.map((level) => (
          <button
            key={level.id}
            className={`wl-chip${filters.level === level.id ? " on" : ""}`}
            onClick={() => patch({ level: level.id })}
          >
            {level.label}
          </button>
        ))}
      </div>

      {/* 分布带：当前筛选下各记忆档的比例，点色块=只看这一档 */}
      <p className="wl-dist-cap">
        已学 <b>{studiedTotal}</b> 词的记忆分布
        {tally.bands.unseen > 0 ? ` · 另有 ${tally.bands.unseen} 词未学` : ""}
      </p>
      <div className="wl-dist" role="group" aria-label="记忆程度分布">
        {studiedLegend.map((item) => (
          <button
            key={item.id}
            data-band={item.id}
            className={`wl-dist-seg${filters.band === item.id ? " on" : ""}`}
            style={{ flexGrow: tally.bands[item.id] }}
            title={`${item.label} ${tally.bands[item.id]} 条 · ${item.hint}`}
            aria-label={`${item.label} ${tally.bands[item.id]} 条`}
            onClick={() => toggleBand(item.id)}
          />
        ))}
      </div>
      <div className="wl-legend">
        {bandLegend.map((item) => (
          <button
            key={item.id}
            className={`wl-legend-item${filters.band === item.id ? " on" : ""}`}
            onClick={() => toggleBand(item.id)}
          >
            <i data-band={item.id} />
            {item.label}
            <b>{tally.bands[item.id]}</b>
          </button>
        ))}
        <button
          className={`wl-legend-item${filters.band === "due" ? " on" : ""}`}
          onClick={() => toggleBand("due")}
        >
          <i className="wl-legend-flag">⏰</i>
          该复习
          <b>{tally.due}</b>
        </button>
        <button
          className={`wl-legend-item${filters.band === "leech" ? " on" : ""}`}
          onClick={() => toggleBand("leech")}
        >
          <i className="wl-legend-flag">🪨</i>
          顽固词
          <b>{tally.leech}</b>
        </button>
      </div>

      <div className="wl-tools">
        <button
          className="wl-select"
          onClick={() => (picking ? exitPicking() : selection.restore(true, []))}
          title="也可以长按任意一行进入，按住往下划一路选过去"
        >
          {picking ? "退出选词" : "选词"}
        </button>
        <div className="wl-more">
          <button className="wl-more-btn" onClick={() => setFilterOpen(!filterOpen)}>
            词性 · 排序
            <ChevronDown size={14} className={filterOpen ? "wl-flip" : ""} />
          </button>
        </div>
      </div>

      {filterOpen && (
        <div className="wl-panel">
          <p className="wl-panel-title">词性</p>
          <div className="wl-chips">
            <button
              className={`wl-chip${filters.pos === "all" ? " on" : ""}`}
              onClick={() => patch({ pos: "all" })}
            >
              全部
            </button>
            {POS_BUCKETS.map((bucket) => (
              <button
                key={bucket.id}
                className={`wl-chip${filters.pos === bucket.id ? " on" : ""}`}
                onClick={() => patch({ pos: bucket.id })}
              >
                {bucket.label}
              </button>
            ))}
          </div>
          <p className="wl-panel-title">排序</p>
          <div className="wl-chips">
            {SORTS.map((sort) => (
              <button
                key={sort.id}
                className={`wl-chip${filters.sort === sort.id ? " on" : ""}`}
                onClick={() => patch({ sort: sort.id })}
              >
                {sort.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="wl-list">
        {rows.map((row) => {
          const checked = selected.has(row.id);
          const forms = wordForms(row);
          return (
            /* 行本身不能再是 button 了：里面还要放「熟知」那颗，button 套 button 不合法 */
            <li
              key={row.id}
              className={`wl-row${checked ? " picked" : ""}`}
              data-band={row.band}
              data-word-id={row.id}
              {...selection.rowHandlers(row.id)}
            >
              {/* 左侧色条：扫一列的时候颜色比文字快 */}
              <i className="wl-row-tick" aria-hidden="true" />
              <button
                className="wl-row-main"
                onClick={() => {
                  // 长按/划选松手的那一下不能顺手把详情也打开
                  if (selection.consumedByGesture()) return;
                  if (picking) selection.toggle(row.id);
                  else setOpenId(row.id);
                }}
              >
                {picking && (
                  <span className={`wl-check${checked ? " on" : ""}`} aria-hidden="true">
                    {checked ? <Check size={13} /> : null}
                  </span>
                )}
                <span className="wl-row-word">
                  <b>{forms.primary}</b>
                  {forms.secondary && <small>{forms.secondary}</small>}
                </span>
                <span className="wl-row-mid">
                  <span className="wl-row-meaning">{row.meaning}</span>
                  <span className="wl-row-tags">
                    {row.level}
                    {row.pos ? ` · ${row.pos}` : ""}
                    {row.isLeech ? " · 顽固" : ""}
                  </span>
                </span>
                <span className="wl-row-mem">
                  <span className="wl-row-status">{statusText(row)}</span>
                  {/* 未学/已掌握时两行会写成同一句话，重复一遍只是噪音 */}
                  {statusText(row) !== bandMeta(row.band).label && (
                    <span className="wl-row-band">{bandMeta(row.band).label}</span>
                  )}
                </span>
              </button>
              <button
                className={`wl-row-known${row.isKnownForever ? " on" : ""}`}
                onClick={() => toggleKnown(row)}
                aria-pressed={row.isKnownForever}
                title={row.isKnownForever ? "放回复习队列" : "我已经会了：算一次学过，然后别再出现"}
              >
                {row.isKnownForever ? <Check size={13} /> : null}
                熟知
              </button>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && <p className="wl-empty">这个筛选下没有词</p>}

      {/* 「正在加载…」本身是个按钮：看着是状态，不是分页器，但万一某个 WebView 里
          滚动事件静默失效，点一下还能把列表推下去，不至于卡死在这一行。 */}
      <div className="wl-sentinel">
        {hasMore && (
          <button className="wl-sentinel-more" onClick={loadMore}>
            正在加载… {rows.length} / {tally.total}
          </button>
        )}
        {!hasMore && rows.length > 0 && <span>到底了 · 共 {rows.length} 条</span>}
      </div>

      {/* 工具条和提示都要挂到 body：页面容器自己开了层叠上下文，
          留在原地的话 z-index 再高也压不过 z-index:9999 的底部导航条 */}
      {picking && createPortal(
        <div className="wl-bar">
          <div className="wl-bar-picks">
            <span className="wl-bar-count">已选 {selected.size}</span>
            <button className="wl-bar-pick" onClick={() => quickPick({}, "当前筛选")}>全选</button>
            <button className="wl-bar-pick" onClick={() => quickPick({ band: "unseen" }, "未学")}>未学</button>
            <button className="wl-bar-pick" onClick={() => quickPick({ band: "due" }, "该复习")}>该复习</button>
            <button className="wl-bar-pick" onClick={() => quickPick({ band: "leech" }, "顽固词")}>顽固</button>
            <button
              className="wl-bar-pick"
              disabled={selected.size === 0}
              onClick={() => selection.setSelectedIds(new Set())}
            >
              清空
            </button>
          </div>
          <div className="wl-bar-acts">
          {onStudyPicked && (
            <button
              className="wl-bar-btn primary"
              disabled={selected.size === 0}
              onClick={() => onStudyPicked([...selected])}
            >
              只学这些
            </button>
          )}
          <button
            className="wl-bar-btn"
            disabled={queueable === 0}
            title={queueable === 0 ? "学过的词不用加，到期会自己出现" : undefined}
            onClick={handleAddToQueue}
          >
            加入队列
          </button>
          <button
            className="wl-bar-btn"
            disabled={selected.size === 0}
            onClick={() => handleMarkKnown(true)}
          >
            标熟知
          </button>
          <button
            className="wl-bar-btn"
            disabled={selected.size === 0}
            onClick={() => handleMarkKnown(false)}
          >
            放回复习
          </button>
          </div>
        </div>,
        document.body
      )}

      {notice && createPortal(
        <div className="wl-notice">
          <span>{notice.text}</span>
          {notice.action && (
            <button
              className="wl-notice-act"
              onClick={() => {
                const run = notice.action!.run;
                setNotice(null);
                run();
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>,
        document.body
      )}

      {openId !== null && (
        <WordDetailSheet
          wordId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refreshRows}
          onQueue={(id) => { setOpenId(null); queueWords([id]); }}
        />
      )}
    </section>
  );
}

/** 只读详情。收藏和笔记可以改（不碰调度），评分一律没有 —— 答案全露着的时候评分等于给 FSRS 灌假数据。 */
const WordDetailSheet = ({
  wordId,
  onClose,
  onChanged,
  onQueue
}: {
  wordId: number;
  onClose: () => void;
  onChanged: () => void;
  /** 只有没学过的词给这个按钮：学过的到期自己会出现，不需要「加入」 */
  onQueue: (wordId: number) => void;
}) => {
  const [detail, setDetail] = useState<WordLibraryDetail | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const data = wordLibraryDetail(wordId);
    setDetail(data);
    setNote(data?.note ?? "");
  }, [wordId]);

  if (!detail) return null;
  const meta = bandMeta(detail.band);
  const forms = wordForms(detail);

  const saveNote = () => {
    if (note === detail.note) return;
    updateWordNote(detail.id, note);
    setDetail({ ...detail, note });
  };

  return createPortal(
    <div className="wl-overlay" onClick={onClose}>
      <div className="wl-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="wl-sheet-head">
          <span className="wl-sheet-level">{detail.level} · {detail.pos}</span>
          <div className="wl-sheet-actions">
            <button
              className={`wl-fav${detail.isFavorite ? " on" : ""}`}
              onClick={() => {
                const { isFavorite } = toggleFavorite("word", detail.id);
                setDetail({ ...detail, isFavorite });
              }}
              aria-label="收藏"
            >
              <Star size={16} />
            </button>
            <button className="wl-close" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        <p className="wl-sheet-word">{forms.primary}</p>
        {forms.secondary && <p className="wl-sheet-kana">{forms.secondary}</p>}
        <p className="wl-sheet-meaning">{detail.meaning}</p>

        {detail.example.jp && (
          <div className="wl-sheet-example">
            <p>{detail.example.jp}</p>
            <span>{detail.example.meaning}</span>
          </div>
        )}

        <div className="wl-sheet-mem" data-band={detail.band}>
          <span className="wl-sheet-mem-band">
            <i data-band={detail.band} />
            {meta.label}
          </span>
          <p className="wl-sheet-mem-hint">{meta.hint}</p>
          <dl className="wl-sheet-stats">
            <div>
              <dt>还能记多久</dt>
              <dd>{detail.stability === null ? "—" : `${detail.stability.toFixed(1)} 天`}</dd>
            </div>
            <div>
              <dt>下次复习</dt>
              {/* 没学过的词写「未学」等于把上面那句话再说一遍 */}
              <dd>{detail.band === "unseen" ? "—" : statusText(detail)}</dd>
            </div>
            <div>
              <dt>复习次数</dt>
              <dd>{detail.reps}</dd>
            </div>
            <div>
              <dt>忘记次数</dt>
              <dd>{detail.lapses}{detail.isLeech ? "（顽固）" : ""}</dd>
            </div>
          </dl>
        </div>

        {detail.band === "unseen" && (
          <button className="wl-sheet-queue" onClick={() => onQueue(detail.id)}>
            加入学习队列
            <small>按每日新词配额排，今天排不下就排在后面几天</small>
          </button>
        )}

        <label className="wl-sheet-note">
          <span>笔记</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => { saveNote(); onChanged(); }}
            placeholder="给这个词写点什么"
            rows={2}
          />
        </label>
      </div>
    </div>,
    document.body
  );
};
