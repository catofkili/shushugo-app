import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { jsMotionAllowed } from "../lib/studyPreferences";
import { AlertTriangle, ArrowLeft, ChevronDown, X, Sparkles, Pause, Play, Palette } from "lucide-react";
import {
  generateLatestWeeklyReport,
  listWeeklyReports,
  markWeeklyReportRead,
  reportWindowLabel,
  reportWindowLabelCompact,
  saveWeeklyReport,
  type WeeklyReportSnapshot
} from "../lib/analytics/weekly-reports";
import { recordWeeklyReportEvent, type WeeklyReportEntry } from "../lib/analytics/weekly-report-events";
// ⚠️ 旧版样式要先于两个新版式的 css 引入：同优先级时后引入的赢，新版的配色得压过旧版。
import "./weekly-report.css";
import { WeeklyReportStory } from "./WeeklyReportStory";
import { StarAtlasStory } from "./weekly/StarAtlasStory";
import { FilmStory } from "./weekly/FilmStory";
import { WEEKLY_VARIANTS, chaptersFor, loadWeeklyVariant, saveWeeklyVariant, type WeeklyVariant } from "./weekly/variants";
import { requestFullSnapshot, saveDatabase } from "../lib/storage";
import { renderWeeklyReportShareImage } from "../lib/weekly-report-share";
import { renderFilmShare, renderStarShare } from "./weekly/share-images";
import { ShareImageSheet } from "../components/ShareImageSheet";
import { canUseFeature, getEntitlements } from "../lib/entitlements";
import type { FeatureId } from "../lib/entitlements";
import { CLOUD_AUTH_EVENT, getCloudSession, getLocalSyncOwnerEmail, listCloudWeeklyReports, getCloudWeeklyReport } from "../lib/sync-api";
import { cancelWeeklyReportNotification } from "../lib/notifications";

interface WeeklyReportPageProps {
  onBack: () => void;
  initialWeekStart?: string | null;
  onRequirePro?: (feature: FeatureId) => void;
  onReviewWords?: (wordIds: number[]) => void;
  /** 从哪进来的：只用于本地观测，不影响任何展示逻辑 */
  entry?: WeeklyReportEntry;
}

/** 三套版式并排，等用户选定一套（见 weekly/variants.ts）。三者接口一致，外壳只管翻页和手势。 */
const STORIES: Record<WeeklyVariant, typeof WeeklyReportStory> = { garden: WeeklyReportStory, stars: StarAtlasStory, film: FilmStory };

export function WeeklyReportPage({ onBack: goHome, initialWeekStart = null, onRequirePro, onReviewWords, entry = "button" }: WeeklyReportPageProps) {
  const [reports, setReports] = useState<WeeklyReportSnapshot[]>([]);
  const [selectedStart, setSelectedStart] = useState<string | null>(initialWeekStart);
  const [page, setPage] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shareCard, setShareCard] = useState<{ url: string; blob: Blob; fileName: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  // 开发预览（5199 这种空库）里没有任何真实周报时，用模拟数据顶上，见 weekly/mock-report.ts。
  // 模拟的这份不写库、不标已读、不记埋点、不给「再练这个词」。
  const [mock, setMock] = useState(false);
  const [cloudHistory, setCloudHistory] = useState<{ week_start: string; uploaded_at: string; byte_length: number }[]>([]);
  const [cloudMessage, setCloudMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const dragRef = useRef<{ x:number; y:number; at:number; id:number; axis:"page"|"week"; locked:boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const lastTurnRef = useRef(0);
  const [outgoing, setOutgoing] = useState<{report: WeeklyReportSnapshot["report"]; chapter:string; variant:WeeklyVariant} | null>(null);
  const [variant, setVariant] = useState<WeeklyVariant>(loadWeeklyVariant);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const historyDialogRef = useRef<HTMLDialogElement | null>(null);
  const weekPickerRef = useRef<HTMLButtonElement | null>(null);
  const readerRef = useRef<HTMLElement | null>(null);
  const reportsRef = useRef<WeeklyReportSnapshot[]>([]);

  const onBack = useCallback(() => {
    const reader = readerRef.current;
    const page = reader?.closest<HTMLElement>(".weekly-report-page");
    if (!page || !jsMotionAllowed() || typeof page.animate !== "function") {
      goHome();
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".zoo-weekly-cord")?.focus({preventScroll:true}));
      return;
    }
    // 旧方案等 520 ms 才挂载主页，退场下方只有空白纸色。
    // 立即切换真实主页，仅保留无交互的画面副本退场；不复制组件、计时器或数据副作用。
    const snapshot = page.cloneNode(true) as HTMLElement;
    snapshot.classList.add("wr-return-snapshot");
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.inert = true;
    snapshot.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    document.body.append(snapshot);
    const savedReader = snapshot.querySelector<HTMLElement>(".weekly-report-reader");
    if (savedReader && reader) savedReader.scrollTop = reader.scrollTop;
    document.documentElement.classList.add("wr-returning-home");
    const clean = () => { snapshot.remove(); document.documentElement.classList.remove("wr-returning-home"); };
    try {
      flushSync(goHome);
      const animation = snapshot.animate([
        {transform:"translateY(0)", opacity:1},
        {transform:"translateY(-100%)", opacity:.9}
      ], {duration:320, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"});
      void animation.finished.then(clean, clean);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".zoo-weekly-cord")?.focus({preventScroll:true}));
    } catch (error) { clean(); throw error; }
  }, [goHome]);

  useEffect(() => {
    reportsRef.current = reports;
  }, [reports]);

  useEffect(() => () => {
    if (shareCard) URL.revokeObjectURL(shareCard.url);
  }, [shareCard]);

  const reload = useCallback(async () => {
    const session = await getCloudSession();
    const owner = await getLocalSyncOwnerEmail();
    setLoadError("");
    if (session.token && session.email && owner !== session.email) {
      setReports([]);
      setSelectedStart(null);
      setLoading(false);
      return;
    }
    const latest = generateLatestWeeklyReport("local");
    const all = listWeeklyReports();
    const canReadHistory = canUseFeature("weeklyReportCloudHistory", getEntitlements());
    // 免费用户只读当前已结束周期；本周没有任何学习记录时，不应回退展示更早的旧周。
    const next = canReadHistory
      ? all
      : latest
        ? all.filter((item) => item.report.window.start === latest.report.window.start)
        : [];
    if (import.meta.env.DEV && next.length === 0) {
      const { mockWeeklyReport } = await import("./weekly/mock-report");
      const report = mockWeeklyReport();
      setReports([{ schemaVersion: 3, generatedAt: Date.now(), readAt: Date.now(), report }]);
      setSelectedStart(report.window.start);
      setMock(true);
      setLoading(false);
      return;
    }
    setMock(false);
    setReports(next);
    setSelectedStart((current) => current ?? latest?.report.window.start ?? next[0]?.report.window.start ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void reload().catch((error) => {
        console.warn("[weekly-report] 读取周报失败", error);
        recordWeeklyReportEvent({ kind: "failed", weekStart: "unknown", at: Date.now(), stage: "load" });
        setLoadError("周报读取失败，请重试。");
        setLoading(false);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reload]);

  useEffect(() => {
    let alive = true;
    const loadCloudHistory = async () => {
      const entitlement = getEntitlements();
      if (!canUseFeature("weeklyReportCloudHistory", entitlement)) {
        if (alive) setCloudHistory([]);
        return;
      }
      const session = await getCloudSession();
      if (!session.token) {
        if (alive) setCloudHistory([]);
        return;
      }
      try {
        const items = await listCloudWeeklyReports();
        if (alive) setCloudHistory(items);
        if (alive && initialWeekStart && !reportsRef.current.some((item) => item.report.window.start === initialWeekStart)) {
          try {
            const payload = await getCloudWeeklyReport(initialWeekStart) as { report?: WeeklyReportSnapshot["report"] };
            if (payload.report) {
              setMock(false);
              const local = saveWeeklyReport(payload.report);
              requestFullSnapshot();
              await saveDatabase().catch(() => undefined);
              if (alive) {
                setReports((current) => current.some((item) => item.report.window.start === local.report.window.start)
                  ? current
                  : [...current, local].sort((left, right) => right.report.window.start.localeCompare(left.report.window.start)));
                setSelectedStart(initialWeekStart);
              }
            }
          } catch {
            if (alive) setCloudMessage("通知对应的周报暂时无法读取。" );
          }
        }
      } catch (error) {
        if (alive) setCloudMessage(error instanceof Error ? error.message : "云端历史读取失败。");
      }
    };
    void loadCloudHistory();
    const handleAuth = () => { void loadCloudHistory(); };
    const handleSync = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status === "downloaded" || status === "merged") {
        void reload().catch(() => setLoadError("周报读取失败，请重试。"));
      }
    };
    window.addEventListener(CLOUD_AUTH_EVENT, handleAuth);
    window.addEventListener("shushugo-cloud-sync", handleSync);
    return () => {
      alive = false;
      window.removeEventListener(CLOUD_AUTH_EVENT, handleAuth);
      window.removeEventListener("shushugo-cloud-sync", handleSync);
    };
  }, [initialWeekStart, reload]);

  const selected = useMemo(
    () => reports.find((item) => item.report.window.start === selectedStart) ?? reports[0] ?? null,
    [reports, selectedStart]
  );
  const selectedReportIndex = selected
    ? reports.findIndex((item) => item.report.window.start === selected.report.window.start)
    : 0;
  // 楼层对应时间周期：最新的已结束周期是二楼，更早的周期依次向上。
  const floorNumber = Math.max(2, selectedReportIndex + 2);
  // 翻页方向：只影响入场动画从哪一侧进来，不改变任何内容。
  const [direction, setDirection] = useState<1 | -1>(1);
  const [floorDirection, setFloorDirection] = useState<1 | -1>(1);
  useEffect(() => {
    const handleVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);
  useEffect(() => {
    if (!outgoing) return;
    const timeout = window.setTimeout(() => setOutgoing(null), 900);
    return () => window.clearTimeout(timeout);
  }, [outgoing]);
  useEffect(() => {
    const dialog = historyDialogRef.current;
    if (historyOpen && dialog && !dialog.open) dialog.showModal();
    else if (!historyOpen && dialog?.open) { dialog.close(); weekPickerRef.current?.focus(); }
  }, [historyOpen]);

  const chapters = chaptersFor(variant, selected?.report ?? null);
  const pageTotal = chapters.length;

  useEffect(() => {
    if (!selected || mock) return;
    recordWeeklyReportEvent({
      kind: "opened",
      weekStart: selected.report.window.start,
      at: Date.now(),
      entry
    });
  }, [entry, selected, mock]);

  useEffect(() => {
    if (!selected || mock || pageTotal <= 0 || page < pageTotal - 1) return;
    recordWeeklyReportEvent({
      kind: "completed",
      weekStart: selected.report.window.start,
      at: Date.now()
    });
  }, [page, pageTotal, selected, mock]);

  useEffect(() => {
    if (!selected || mock) return;
    const markedRead = markWeeklyReportRead(selected.report.window.start);
    const isLatest = reports[0]?.report.window.start === selected.report.window.start;
    if (markedRead || isLatest) {
      void cancelWeeklyReportNotification().catch(() => undefined);
    }
    if (markedRead) {
      requestFullSnapshot();
      void saveDatabase().catch(() => undefined);
    }
  }, [reports, selected, mock]);

  /** 分享长图跟着版式走：星图 / 放映厅各画各的，字间小院用原来那张。保存、发微信好友、发朋友圈都在 ShareImageSheet 里。 */
  const createSharePreview = async () => {
    if (!selected || shareBusy) return;
    setShareBusy(true);
    setShareMessage("");
    try {
      const report = selected.report;
      const blob = variant === "stars" ? await renderStarShare(report)
        : variant === "film" ? await renderFilmShare(report)
          : (await renderWeeklyReportShareImage(report)).blob;
      setShareCard({ url: URL.createObjectURL(blob), blob, fileName: `shushugo-weekly-${report.window.start}-${variant}.png` });
    } catch {
      setShareMessage("长图生成失败，请稍后再试。");
    } finally {
      setShareBusy(false);
    }
  };
  const closeShare = () => {
    setShareCard(null);
  };

  const movePage = useCallback((delta: number) => {
    if (!selected || shareCard || historyOpen || performance.now() - lastTurnRef.current < 160) return;
    const next = Math.max(0, Math.min(pageTotal - 1, page + delta));
    if (next === page) return;
    lastTurnRef.current = performance.now();
    setOutgoing({report:selected.report, chapter:chapters[page]?.id ?? "cover", variant});
    setDirection(delta > 0 ? 1 : -1);
    setPage(next);
  }, [selected, shareCard, historyOpen, pageTotal, page, chapters, variant]);
  const cycleVariant = () => {
    const next = WEEKLY_VARIANTS[(WEEKLY_VARIANTS.findIndex((item) => item.id === variant) + 1) % WEEKLY_VARIANTS.length].id;
    saveWeeklyVariant(next);
    setOutgoing(null);
    setDirection(1);
    setVariant(next);
    setPage(0);
  };
  const moveWeek = useCallback((delta: number) => {
    const next = reports[selectedReportIndex + delta];
    if (!next || shareCard || historyOpen) return;
    setOutgoing(null);
    setDirection(1);
    setFloorDirection(delta > 0 ? 1 : -1);
    setSelectedStart(next.report.window.start);
    setPage(0);
  }, [reports, selectedReportIndex, shareCard, historyOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (readerRef.current) readerRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, selected?.report.window.start]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (shareCard || historyOpen || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true'],dialog"))) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); movePage(1); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); movePage(-1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveWeek(-1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); moveWeek(1); }
      else if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [movePage, moveWeek, onBack, shareCard, historyOpen]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    let total = 0;
    let previousAt = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || shareCard || historyOpen) return; // 浏览器缩放不用于翻篇。
      const now = performance.now();
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      // 长页始终保留原生纵向阅读；只在本来不需要滚动的场景用滚轮翻页。
      if (!horizontal && reader.scrollHeight > reader.clientHeight + 4) return;
      event.preventDefault();
      if (now - lastTurnRef.current < 700) return;
      const delta = (horizontal ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
      if (now - previousAt > 180 || Math.sign(delta) !== Math.sign(total)) total = 0;
      previousAt = now;
      total += delta;
      if (Math.abs(total) >= 60) { movePage(total > 0 ? 1 : -1); total = 0; }
    };
    reader.addEventListener("wheel", wheel, {passive:false});
    return () => reader.removeEventListener("wheel", wheel);
  }, [movePage, shareCard, historyOpen, loading, selected?.report.window.start]);

  const startDrag = (event: PointerEvent<HTMLElement>, axis: "page"|"week" = "page") => {
    suppressClickRef.current = false;
    if (!event.isPrimary || event.button !== 0 || shareCard || historyOpen) return;
    const target = event.target as HTMLElement;
    if (axis === "page" && target.closest("button:not([data-word-art]),a,input,select,textarea")) return;
    dragRef.current = {x:event.clientX,y:event.clientY,at:performance.now(),id:event.pointerId,axis,locked:false};
  };
  const dragMove = (event: PointerEvent<HTMLElement>) => {
    const start = dragRef.current;
    if (!start || start.id !== event.pointerId) return;
    const primary = start.axis === "page" ? event.clientX - start.x : event.clientY - start.y;
    const secondary = start.axis === "page" ? event.clientY - start.y : event.clientX - start.x;
    if (!start.locked && Math.abs(secondary) > 12 && Math.abs(secondary) > Math.abs(primary)) { dragRef.current = null; return; }
    if (Math.abs(primary) < 8) return;
    if (!start.locked) { start.locked=true; event.currentTarget.setPointerCapture(event.pointerId); }
    suppressClickRef.current = true;
    readerRef.current?.style.setProperty(start.axis === "page" ? "--drag-x" : "--drag-y", `${Math.max(-120,Math.min(120,primary*.4))}px`);
    readerRef.current?.classList.add("is-dragging");
  };
  const resetDrag = () => {
    dragRef.current = null;
    readerRef.current?.style.removeProperty("--drag-x");
    readerRef.current?.style.removeProperty("--drag-y");
    readerRef.current?.classList.remove("is-dragging");
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const start = dragRef.current;
    resetDrag();
    if (!start || start.id !== event.pointerId || !start.locked) return;
    const delta = start.axis === "page" ? event.clientX-start.x : event.clientY-start.y;
    const elapsed = Math.max(1,performance.now()-start.at);
    if (Math.abs(delta)>=56 || (Math.abs(delta)>=24 && Math.abs(delta)/elapsed>.4)) {
      if (start.axis === "page") movePage(delta<0 ? 1 : -1);
      else moveWeek(delta<0 ? 1 : -1);
    }
  };

  if (loading) {
    return <div className="weekly-report-page"><button className="weekly-report-back" onClick={onBack}><ArrowLeft size={17} />主页</button><div className="weekly-report-empty" role="status"><span className="wr-loading-mark" aria-hidden="true">2F</span><p>正在打开这一周的手记…</p></div></div>;
  }

  if (loadError) {
    return (
      <div className="weekly-report-page">
        <div className="weekly-report-toolbar">
          <button className="weekly-report-back" onClick={onBack}><ArrowLeft size={17} />主页</button>
        </div>
        <div className="weekly-report-empty" role="alert">
          <AlertTriangle size={28} aria-hidden="true" />
          <h1>学习回顾暂时打不开</h1>
          <p>{loadError}</p>
          <button className="weekly-report-primary" onClick={() => { setLoading(true); void reload().catch(() => { setLoadError("周报读取失败，请重试。"); setLoading(false); }); }}>重试</button>
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="weekly-report-page">
        <div className="weekly-report-toolbar">
          <button className="weekly-report-back" onClick={onBack}><ArrowLeft size={17} />主页</button>
        </div>
        <div className="weekly-report-empty">
          <img className="weekly-report-empty-brand" src="/brand/shushugo-cover.png" alt="收集日封面" />
          <Sparkles size={28} aria-hidden="true" />
          <h1>学习回顾</h1>
          <p>周日午后，来收下这一周的日语时光。</p>
        </div>
      </div>
    );
  }

  const report = selected.report;
  const chapter = chapters[page]?.id ?? "cover";
  const Story = STORIES[variant];
  const OutgoingStory = outgoing ? STORIES[outgoing.variant] : null;
  return (
    <div className={`weekly-report-page wr-experience wr-variant-${variant} wr-theme-${chapter}`} data-paused={paused || hidden ? "true" : "false"} onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false; } }}>
      <header className="wr-experience-header">
        <button className="wr-icon-control" onClick={onBack} aria-label="关闭回顾，回到主页"><X size={20}/></button>
        <button ref={weekPickerRef} className="wr-week-picker" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)} onPointerDown={(event) => startDrag(event,"week")} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={resetDrag}>
          <span>{floorNumber}F <i> / </i> {reportWindowLabelCompact(report.window)}</span><ChevronDown size={13}/>
        </button>
        {mock && <span className="wr-mock-badge">模拟数据 · 仅开发预览</span>}
        <div className="wr-header-tools">
          {/* 三套版式并排比较用；用户选定之后连同另外两套一起删掉 */}
          <button className="wr-variant-switch" onClick={cycleVariant} aria-label={`切换周报版式，当前：${WEEKLY_VARIANTS.find((item) => item.id === variant)?.label}`}><Palette size={14}/>{WEEKLY_VARIANTS.find((item) => item.id === variant)?.label}</button>
          <button className="wr-icon-control" onClick={() => setPaused(!paused)} aria-label={paused ? "播放场景动效" : "暂停场景动效"} aria-pressed={paused}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button>
        </div>
      </header>
      <section ref={readerRef} className="weekly-report-reader" data-dir={direction} data-floor-dir={floorDirection} key={report.window.start} tabIndex={-1} aria-label="学习回顾，左右滑动翻篇，日期区域上下滑动切周" onPointerDown={(event)=>startDrag(event)} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={resetDrag}>
        <p className="wr-sr-only" role="status">第 {page+1} 篇，共 {chapters.length} 篇：{chapters[page]?.label}</p>
        <div className="wr-drag-layer">
          {outgoing && OutgoingStory && <div className={`wr-outgoing wr-theme-${outgoing.chapter}`} aria-hidden="true" inert><OutgoingStory report={outgoing.report} chapter={outgoing.chapter} onBack={()=>{}} onShare={()=>{}} animate={false}/></div>}
          <div className={`wr-stage wr-theme-${chapter}`} key={`${variant}:${report.window.start}:${page}`}>
            <Story report={report} chapter={chapter} animate={!paused && !hidden} onBack={onBack} onShare={createSharePreview} onReviewWords={onReviewWords && !mock ? (ids) => {
              recordWeeklyReportEvent({kind:"review_added",weekStart:report.window.start,at:Date.now()});
              onReviewWords(ids);
            } : undefined}/>
          </div>
        </div>
      </section>
      <footer className="wr-gesture-footer">
        <div className="wr-progress" aria-label={`第 ${page+1} 篇，共 ${chapters.length} 篇`}>{chapters.map((item,index)=><i key={item.id} className={index===page ? "is-current" : index<page ? "is-past" : ""}/>)}</div>
        <span className="wr-gesture-hint">{page===chapters.length-1 ? "这一页，替你收好" : "←  左右滑动，翻看这一周  →"}</span>
        <span className="wr-scene-number">{String(page+1).padStart(2,"0")}<i> / {String(chapters.length).padStart(2,"0")}</i></span>
      </footer>
      {/* 视觉上收掉翻页按钮；键盘聚焦时才出现，保留读屏和开关控制的可操作入口。 */}
      <nav className="wr-access-nav" aria-label="辅助翻页"><button disabled={page===0} onClick={()=>movePage(-1)}>上一篇</button><button disabled={page===chapters.length-1} onClick={()=>movePage(1)}>下一篇</button></nav>
      <dialog ref={historyDialogRef} className="wr-history-dialog" aria-label="选择往期回顾" onCancel={()=>setHistoryOpen(false)} onClose={()=>setHistoryOpen(false)} onClick={(event)=>{if(event.target===event.currentTarget)setHistoryOpen(false);}}>
        <div className="wr-history-sheet"><div className="wr-history-heading"><div><p>TIME ARCHIVE</p><h2>往期的日子</h2></div><button className="wr-icon-control" aria-label="关闭往期回顾" onClick={()=>setHistoryOpen(false)}><X size={20}/></button></div>
          <p className="wr-history-range">{reportWindowLabel(report.window)}</p>
          <div className="weekly-report-history">
          {reports.map((item, index) => (
            <button
              key={item.report.window.start}
              className={item.report.window.start === report.window.start ? "selected" : ""}
              aria-current={item.report.window.start === report.window.start ? "true" : undefined}
              onClick={() => { setOutgoing(null); setDirection(1); setFloorDirection(index > selectedReportIndex ? 1 : -1); setSelectedStart(item.report.window.start); setPage(0); setHistoryOpen(false); }}
            >
              <span className="wr-history-floor" aria-hidden="true">{index + 2}F</span>
              <span>{reportWindowLabelCompact(item.report.window)}<small>{item.report.metrics.days} 个学习日 · {index === 0 ? "最新一期" : "往期回顾"}</small></span>

            </button>
          ))}
          {cloudHistory.filter((item) => !reports.some((local) => local.report.window.start === item.week_start)).map((item) => (
            <button
              key={`cloud:${item.week_start}`}
              className="weekly-report-cloud-item"
              onClick={async () => {
                try {
                  const payload = await getCloudWeeklyReport(item.week_start) as { report?: WeeklyReportSnapshot["report"] };
                  if (payload.report) {
                    setMock(false);
                    const local = saveWeeklyReport(payload.report);
                    requestFullSnapshot();
                    await saveDatabase().catch(() => undefined);
                    setReports((current) => [...current, local].sort((left, right) => right.report.window.start.localeCompare(left.report.window.start)));
                    setSelectedStart(item.week_start);
                    setPage(0);
                    setHistoryOpen(false);
                  }
                } catch {
                  setCloudMessage("云端周报读取失败。");
                }
              }}
            >
              {item.week_start.replace(/-/g, ".")} · 云端
              <small>Pro 历史</small>
            </button>
          ))}
          {cloudMessage && <small className="weekly-report-cloud-message">{cloudMessage}</small>}
          {!canUseFeature("weeklyReportCloudHistory", getEntitlements()) && onRequirePro && (
            <button className="weekly-report-cloud-upsell" onClick={() => onRequirePro("weeklyReportCloudHistory")}>
              <span>翻阅往期手记 <small>Pro · 历史归档与恢复</small></span>
            </button>
          )}
          </div>
        </div>
      </dialog>
      {shareMessage && <p className="weekly-report-share-message wr-toast" role="status">{shareMessage}</p>}
      {shareCard && (
        <ShareImageSheet title="这一周的分享图" url={shareCard.url} alt="周报分享长图" blob={shareCard.blob} fileName={shareCard.fileName} shareTitle="收集日 · 我这一周的日语" onClose={closeShare} />
      )}
    </div>
  );
}
