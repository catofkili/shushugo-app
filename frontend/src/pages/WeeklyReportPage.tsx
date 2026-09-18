import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { jsMotionAllowed } from "../lib/studyPreferences";
import { AlertTriangle, ArrowLeft, ChevronDown, X, Sparkles, Pause, Play } from "lucide-react";
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
import { WeeklyReportStory, weeklyChapters } from "./WeeklyReportStory";
import "./weekly-report.css";
import { requestFullSnapshot, saveDatabase } from "../lib/storage";
import { renderWeeklyReportShareImage, type WeeklyReportShareImage } from "../lib/weekly-report-share";
import { saveImageToGallery, shareImage } from "../lib/share-image";
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

export function WeeklyReportPage({ onBack: goHome, initialWeekStart = null, onRequirePro, onReviewWords, entry = "button" }: WeeklyReportPageProps) {
  const [reports, setReports] = useState<WeeklyReportSnapshot[]>([]);
  const [selectedStart, setSelectedStart] = useState<string | null>(initialWeekStart);
  const [page, setPage] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sharePreview, setSharePreview] = useState<WeeklyReportShareImage | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [cloudHistory, setCloudHistory] = useState<{ week_start: string; uploaded_at: string; byte_length: number }[]>([]);
  const [cloudMessage, setCloudMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const dragRef = useRef<{ x:number; y:number; at:number; id:number; axis:"page"|"week"; locked:boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const lastTurnRef = useRef(0);
  const [outgoing, setOutgoing] = useState<{report: WeeklyReportSnapshot["report"]; chapter:string} | null>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const historyDialogRef = useRef<HTMLDialogElement | null>(null);
  const weekPickerRef = useRef<HTMLButtonElement | null>(null);
  const readerRef = useRef<HTMLElement | null>(null);
  const reportsRef = useRef<WeeklyReportSnapshot[]>([]);
  const shareDialogRef = useRef<HTMLDivElement | null>(null);
  const shareTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  const chapters = weeklyChapters(selected?.report ?? null);
  const pageTotal = chapters.length;

  useEffect(() => {
    if (!selected) return;
    recordWeeklyReportEvent({
      kind: "opened",
      weekStart: selected.report.window.start,
      at: Date.now(),
      entry
    });
  }, [entry, selected]);

  useEffect(() => {
    if (!selected || pageTotal <= 0 || page < pageTotal - 1) return;
    recordWeeklyReportEvent({
      kind: "completed",
      weekStart: selected.report.window.start,
      at: Date.now()
    });
  }, [page, pageTotal, selected]);

  useEffect(() => {
    if (!selected) return;
    const markedRead = markWeeklyReportRead(selected.report.window.start);
    const isLatest = reports[0]?.report.window.start === selected.report.window.start;
    if (markedRead || isLatest) {
      void cancelWeeklyReportNotification().catch(() => undefined);
    }
    if (markedRead) {
      requestFullSnapshot();
      void saveDatabase().catch(() => undefined);
    }
  }, [reports, selected]);

  const createSharePreview = async () => {
    if (!selected || shareBusy) return;
    shareTriggerRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setShareBusy(true);
    setShareMessage("");
    try {
      setSharePreview(await renderWeeklyReportShareImage(selected.report));
    } catch {
      setShareMessage("长图生成失败，请稍后再试。");
    } finally {
      setShareBusy(false);
    }
  };

  useEffect(() => {
    if (!sharePreview) return;
    const frame = window.requestAnimationFrame(() => shareDialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [sharePreview]);

  const movePage = useCallback((delta: number) => {
    if (!selected || sharePreview || historyOpen || performance.now() - lastTurnRef.current < 160) return;
    const next = Math.max(0, Math.min(pageTotal - 1, page + delta));
    if (next === page) return;
    lastTurnRef.current = performance.now();
    setOutgoing({report:selected.report, chapter:weeklyChapters(selected.report)[page]?.id ?? "cover"});
    setDirection(delta > 0 ? 1 : -1);
    setPage(next);
  }, [selected, sharePreview, historyOpen, pageTotal, page]);
  const moveWeek = useCallback((delta: number) => {
    const next = reports[selectedReportIndex + delta];
    if (!next || sharePreview || historyOpen) return;
    setOutgoing(null);
    setDirection(1);
    setFloorDirection(delta > 0 ? 1 : -1);
    setSelectedStart(next.report.window.start);
    setPage(0);
  }, [reports, selectedReportIndex, sharePreview, historyOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (readerRef.current) readerRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, selected?.report.window.start]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (sharePreview || historyOpen || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true'],dialog"))) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); movePage(1); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); movePage(-1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveWeek(-1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); moveWeek(1); }
      else if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [movePage, moveWeek, onBack, sharePreview, historyOpen]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader) return;
    let total = 0;
    let previousAt = 0;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || sharePreview || historyOpen) return; // 浏览器缩放不用于翻篇。
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
  }, [movePage, sharePreview, historyOpen, loading, selected?.report.window.start]);

  const startDrag = (event: PointerEvent<HTMLElement>, axis: "page"|"week" = "page") => {
    suppressClickRef.current = false;
    if (!event.isPrimary || event.button !== 0 || sharePreview || historyOpen) return;
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

  const sharePreviewImage = async () => {
    if (!sharePreview || !selected || shareBusy) return;
    setShareBusy(true);
    setShareMessage("");
    try {
      const filename = `shushugo-weekly-${selected.report.window.start}.png`;
      const result = await shareImage(sharePreview.blob, filename, "收集日学习回顾");
      if (result === "unsupported") {
        await saveImageToGallery(sharePreview.blob, filename);
        setShareMessage("当前浏览器不支持系统分享，已改为下载图片。");
      } else if (result === "canceled") {
        setShareMessage("已取消分享。");
      } else {
        setShareMessage("分享面板已打开。");
      }
    } catch {
      setShareMessage("分享失败；你仍可以保存图片到本地。");
    } finally {
      setShareBusy(false);
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
          <Sparkles size={28} aria-hidden="true" />
          <h1>学习回顾</h1>
          <p>周日午后，来收下这一周的日语时光。</p>
        </div>
      </div>
    );
  }

  const report = selected.report;
  const chapter = chapters[page]?.id ?? "cover";
  return (
    <div className={`weekly-report-page wr-experience wr-theme-${chapter}`} data-paused={paused || hidden ? "true" : "false"} onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false; } }}>
      <header className="wr-experience-header">
        <button className="wr-icon-control" onClick={onBack} aria-label="关闭回顾，回到主页"><X size={20}/></button>
        <button ref={weekPickerRef} className="wr-week-picker" aria-haspopup="dialog" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)} onPointerDown={(event) => startDrag(event,"week")} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={resetDrag}>
          <span>{floorNumber}F <i> / </i> {reportWindowLabelCompact(report.window)}</span><ChevronDown size={13}/>
        </button>
        <button className="wr-icon-control" onClick={() => setPaused(!paused)} aria-label={paused ? "播放场景动效" : "暂停场景动效"} aria-pressed={paused}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button>
      </header>
      <section ref={readerRef} className="weekly-report-reader" data-dir={direction} data-floor-dir={floorDirection} key={report.window.start} tabIndex={-1} aria-label="学习回顾，左右滑动翻篇，日期区域上下滑动切周" onPointerDown={(event)=>startDrag(event)} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={resetDrag}>
        <p className="wr-sr-only" role="status">第 {page+1} 篇，共 {chapters.length} 篇：{chapters[page]?.label}</p>
        <div className="wr-drag-layer">
          {outgoing && <div className={`wr-outgoing wr-theme-${outgoing.chapter}`} aria-hidden="true" inert><WeeklyReportStory report={outgoing.report} chapter={outgoing.chapter} onBack={()=>{}} onShare={()=>{}} animate={false}/></div>}
          <div className={`wr-stage wr-theme-${chapter}`} key={`${report.window.start}:${page}`}>
            <WeeklyReportStory report={report} chapter={chapter} animate={!paused && !hidden} onBack={onBack} onShare={createSharePreview} onReviewWords={onReviewWords ? (ids) => {
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
      {shareMessage && !sharePreview && <p className="weekly-report-share-message wr-toast" role="status">{shareMessage}</p>}
      {sharePreview && (
        <div className="weekly-report-share-backdrop" role="presentation" onClick={() => { setSharePreview(null); shareTriggerRef.current?.focus(); }}>
          <div ref={shareDialogRef} className="weekly-report-share-dialog" role="dialog" aria-modal="true" aria-label="预览周报长图" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setSharePreview(null);
              window.requestAnimationFrame(() => shareTriggerRef.current?.focus());
              return;
            }
            if (event.key === "Tab") {
              const focusables = [...shareDialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])") ?? []].filter((node) => !node.hasAttribute("disabled"));
              if (!focusables.length) return;
              const first = focusables[0];
              const last = focusables[focusables.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
          }} tabIndex={-1}>
            <div className="weekly-report-share-dialog-head">
              <b>分享预览</b>
              <button onClick={() => { setSharePreview(null); shareTriggerRef.current?.focus(); }} aria-label="关闭预览">关闭</button>
            </div>
            <img src={sharePreview.dataUrl} alt="周报长图预览" />
            {shareMessage && <p className="weekly-report-share-message">{shareMessage}</p>}
            <div className="weekly-report-share-actions">
              <button onClick={() => void sharePreviewImage()} disabled={shareBusy}>{shareBusy ? "处理中…" : "分享图片"}</button>
              <button onClick={async () => {
                if (!selected || shareBusy) return;
                setShareBusy(true);
                try {
                  await saveImageToGallery(sharePreview.blob, `shushugo-weekly-${selected.report.window.start}.png`);
                  setShareMessage("图片已保存。");
                } catch {
                  setShareMessage("图片保存失败。");
                } finally {
                  setShareBusy(false);
                }
              }} disabled={shareBusy}>保存图片</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
