import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, CalendarDays, Clock3, Eye, RotateCcw, Star, StickyNote, X } from "lucide-react";
import { WordAnswer, WordCard, WordLevelFilter, WordSessionResponse, WordStats, WordTypeFilter } from "../types/vocabulary";
import { addWordStudySeconds, getWordSession, submitWordAnswer, toggleFavorite, undoLastWordAnswer, updateWordNote } from "../lib/api";
import { getStudyPreferences, PREFERENCES_EVENT, StudyPreferences } from "../lib/studyPreferences";
import { addStudyTime, checkAchievements } from "../lib/userProfile";
import { triggerMemoryHaptic } from "../lib/haptics";
import { AnalyticsDashboard } from "../components/AnalyticsDashboard";

const answerOptions: { value: WordAnswer; label: string }[] = [
  { value: "forgot", label: "忘记" },
  { value: "fuzzy", label: "模糊" },
  { value: "know", label: "认识" },
  { value: "known_forever", label: "熟知" }
];

const levelOptions: { value: WordLevelFilter; label: string }[] = [
  { value: "All", label: "全部" },
  { value: "N5", label: "N5" },
  { value: "N4", label: "N4" },
  { value: "N3", label: "N3" },
  { value: "N2", label: "N2" },
  { value: "N1", label: "N1" },
  { value: "Unleveled", label: "未分级" }
];

const typeOptions: { value: WordTypeFilter; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "noun", label: "名词" },
  { value: "verb", label: "动词" },
  { value: "adjective", label: "形容词" },
  { value: "adverb", label: "副词" },
  { value: "favorite", label: "收藏" }
];

const hasAscii = (text: string) => /[A-Za-z]/.test(text);
const hasKatakana = (text: string) => /[\u30a0-\u30ff]/.test(text);

const isLoanwordSourceCard = (card: WordCard) => hasAscii(card.kanji) && hasKatakana(card.kana);

const primaryAnswerText = (card: WordCard) => isLoanwordSourceCard(card) ? card.kana : card.kanji;

const secondaryAnswerText = (card: WordCard) => {
  if (isLoanwordSourceCard(card)) return card.kanji;
  return card.kana;
};

const cardLabel = (card: WordCard) => {
  const primary = primaryAnswerText(card);
  const secondary = secondaryAnswerText(card);
  return primary === secondary ? primary : `${primary} / ${secondary}`;
};

const kanaMap: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo",
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
  ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
  ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
  ワ: "wa", ヲ: "wo", ン: "n",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po"
};

const yoonMap: Record<string, string> = {
  kya: "kya", kiya: "kya", kyu: "kyu", kiyu: "kyu", kyo: "kyo", kiyo: "kyo",
  sha: "sha", shiya: "sha", shu: "shu", shiyu: "shu", sho: "sho", shiyo: "sho",
  cha: "cha", chiya: "cha", chu: "chu", chiyu: "chu", cho: "cho", chiyo: "cho",
  nya: "nya", niya: "nya", nyu: "nyu", niyu: "nyu", nyo: "nyo", niyo: "nyo",
  hya: "hya", hiya: "hya", hyu: "hyu", hiyu: "hyu", hyo: "hyo", hiyo: "hyo",
  mya: "mya", miya: "mya", myu: "myu", miyu: "myu", myo: "myo", miyo: "myo",
  rya: "rya", riya: "rya", ryu: "ryu", riyu: "ryu", ryo: "ryo", riyo: "ryo",
  gya: "gya", giya: "gya", gyu: "gyu", giyu: "gyu", gyo: "gyo", giyo: "gyo",
  ja: "ja", jiya: "ja", ju: "ju", jiyu: "ju", jo: "jo", jiyo: "jo",
  bya: "bya", biya: "bya", byu: "byu", biyu: "byu", byo: "byo", biyo: "byo",
  pya: "pya", piya: "pya", pyu: "pyu", piyu: "pyu", pyo: "pyo", piyo: "pyo"
};

const kanaToRomaji = (text: string) => {
  const parts: string[] = [];
  let doubleNext = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "っ" || char === "ッ") {
      doubleNext = true;
      continue;
    }
    if (char === "ー") {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""}-`;
      continue;
    }
    const base = kanaMap[char];
    const next = kanaMap[text[index + 1]];
    let roman = base ?? char;
    if (next && ["ゃ", "ゅ", "ょ", "ャ", "ュ", "ョ"].includes(text[index + 1])) {
      roman = yoonMap[`${roman}${next}`] ?? roman;
      index += 1;
    }
    if (doubleNext && /^[bcdfghjklmnpqrstvwxyz]/.test(roman)) roman = `${roman[0]}${roman}`;
    doubleNext = false;
    parts.push(roman);
  }
  return parts.join(" ");
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}小时${restMinutes.toString().padStart(2, "0")}分`;
  }
  if (minutes > 0) return `${minutes}分${remainder.toString().padStart(2, "0")}秒`;
  return `${remainder}秒`;
};

const monthDays = (studyDate: string) => {
  const base = studyDate ? new Date(`${studyDate}T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = Array.from({ length: firstDay.getDay() }, () => null);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return {
      day,
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    };
  });
  return {
    title: `${year}年${month + 1}月`,
    cells: [...prefix, ...days]
  };
};

const KanjiAnswer = ({ card }: { card: WordCard }) => {
  if (isLoanwordSourceCard(card)) {
    return <>{card.kana}</>;
  }

  const components = card.kanjiComponents ?? [];
  const componentByChar = new Map(components.map((component) => [component.char, component]));

  return (
    <>
      {[...card.kanji].map((char, index) => {
        const component = componentByChar.get(char);
        const isVariant = Boolean(component?.marked);
        return (
          <span
            key={`${char}-${index}`}
            className={isVariant ? "kanji-variant-mark" : undefined}
            title={isVariant && component ? `${component.char} → ${component.simplified}` : undefined}
          >
            {char}
          </span>
        );
      })}
    </>
  );
};

const FinishPanel = ({ stats, phase, localSeconds }: { stats: WordStats | null; phase: string; localSeconds: number }) => {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const studyDate = stats?.studyDate ?? new Date().toISOString().slice(0, 10);
  const calendar = monthDays(studyDate);
  const checkins = new Set(stats?.checkins ?? []);
  const totalSeconds = (stats?.wordStudySecondsToday ?? 0) + localSeconds;

  // 判断是否是 Stage 1 完成（显示分析入口）
  const isStage1Complete = phase === "stage1" && stats?.stage1Done;

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/15 bg-[#464949] p-4 text-center sm:p-5">
        <div className="mx-auto w-full max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Daily Complete</p>
          <h2 className="mt-3 text-3xl font-semibold">今日单词完成</h2>
          <div className="mx-auto mt-4 grid max-w-lg gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
              <div className="flex items-center gap-2 text-white/65">
                <Clock3 size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">背词用时</p>
              </div>
              <p className="mt-3 text-2xl font-semibold">{formatDuration(totalSeconds)}</p>
              <p className="mt-2 text-xs text-white/55">只统计单词学习页打开期间</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-3 text-left sm:p-4">
              <div className="flex items-center gap-2 text-white/65">
                <CalendarDays size={17} />
                <p className="text-xs font-bold uppercase tracking-[0.16em]">打卡状态</p>
              </div>
              <p className="mt-3 text-2xl font-semibold">{checkins.has(studyDate) ? "已打卡" : "待打卡"}</p>
              <p className="mt-2 text-xs text-white/55">学习日：{studyDate}</p>
            </div>
          </div>

          {/* Stage 1 完成后显示分析入口 */}
          {isStage1Complete && (
            <div className="mx-auto mt-4 max-w-lg">
              <button
                onClick={() => setShowAnalytics(true)}
                className="focus-ring w-full rounded-2xl border border-[#81D8CF]/30 bg-[#81D8CF]/10 p-4 text-left transition-all hover:bg-[#81D8CF]/20"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20">
                    <BarChart3 size={22} className="text-[#81D8CF]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-white">查看学习分析</p>
                    <p className="mt-0.5 text-xs text-white/60">了解你的学习进度和薄弱点</p>
                  </div>
                  <span className="text-2xl">📊</span>
                </div>
              </button>
            </div>
          )}

          <div className="mx-auto mt-4 max-w-lg rounded-2xl border border-white/15 bg-[#3f4343] p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-semibold">{calendar.title}</p>
              <p className="text-xs text-white/55">phase: {phase}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#343838] p-3">
              <div className="grid grid-cols-7 gap-1 text-xs">
              {["日", "一", "二", "三", "四", "五", "六"].map((label) => (
                <span key={label} className="grid h-7 place-items-center text-white/45">{label}</span>
              ))}
              {calendar.cells.map((cell, index) => {
                if (!cell) return <span key={`empty-${index}`} className="h-10" />;
                const checked = checkins.has(cell.date);
                const isToday = cell.date === studyDate;
                return (
                  <span
                    key={cell.date}
                    className="grid h-10 place-items-center"
                    title={cell.date}
                  >
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold ${
                        checked
                          ? "border-[#81D8CF] bg-[#81D8CF]/18 text-white shadow-[0_0_0_3px_rgba(129,216,207,0.12)]"
                          : "border-transparent text-white/55"
                      } ${isToday ? "shadow-[0_0_0_3px_rgba(129,216,207,0.35)]" : ""}`}
                    >
                      {cell.day}
                    </span>
                  </span>
                );
              })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 分析面板弹窗 */}
      {showAnalytics && <AnalyticsDashboard onClose={() => setShowAnalytics(false)} />}
    </>
  );
};

export const WordStudy = () => {
  const [card, setCard] = useState<WordCard | null>(null);
  const [stats, setStats] = useState<WordStats | null>(null);
  const [phase, setPhase] = useState("loading");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteMemoryOpen, setNoteMemoryOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [localStudySeconds, setLocalStudySeconds] = useState(0);
  const [selectedLevel, setSelectedLevel] = useState<WordLevelFilter>(() => (localStorage.getItem("mn-word-level") as WordLevelFilter | null) ?? "All");
  const [selectedType, setSelectedType] = useState<WordTypeFilter>(() => (localStorage.getItem("mn-word-type") as WordTypeFilter | null) ?? "all");
  const [preferences, setPreferences] = useState<StudyPreferences>(() => getStudyPreferences());
  const [error, setError] = useState("");
  const lastStudyTickRef = useRef(Date.now());
  const trackingActiveRef = useRef(false);

  const progressText = useMemo(() => {
    if ((selectedLevel !== "All" || selectedType !== "all") && stats?.total) {
      return `${stats.knownForever}/${stats.total}`;
    }
    if (!stats?.stage1ProgressTotal) return "";
    return `${stats.stage1ProgressDone}/${stats.stage1ProgressTotal}`;
  }, [selectedLevel, selectedType, stats]);

  const markedKanji = useMemo(() => {
    return (card?.kanjiComponents ?? []).filter((component) => component.marked);
  }, [card]);

  const romaji = useMemo(() => card ? kanaToRomaji(secondaryAnswerText(card)) : "", [card]);

  const sessionOptions = useMemo(() => ({
    level: selectedLevel,
    type: selectedType
  }), [selectedLevel, selectedType]);

  const loadNext = async () => {
    setLoading(true);
    setError("");
    try {
      const data: WordSessionResponse = getWordSession(sessionOptions);
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取本地词库");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem("mn-word-level", selectedLevel);
    localStorage.setItem("mn-word-type", selectedType);
    loadNext();
  }, [selectedLevel, selectedType]);

  useEffect(() => {
    const handlePreferences = (event: Event) => {
      setPreferences((event as CustomEvent<StudyPreferences>).detail ?? getStudyPreferences());
    };
    window.addEventListener(PREFERENCES_EVENT, handlePreferences);
    return () => window.removeEventListener(PREFERENCES_EVENT, handlePreferences);
  }, []);

  const playPronunciation = (text: string) => {
    if (!preferences.autoPlay || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  };

  const sendStudySeconds = async (seconds: number) => {
    if (seconds <= 0) return null;
    setLocalStudySeconds((value) => value + seconds);
    try {
      const data = addWordStudySeconds(seconds);
      setStats(data.stats);
      setLocalStudySeconds(0);

      // 同步到用户资料（分钟）
      const minutes = Math.floor(seconds / 60);
      if (minutes > 0) {
        await addStudyTime(minutes);
        // 检查是否解锁新成就
        await checkAchievements();
      }

      return data.stats;
    } catch {
      // Time tracking should never interrupt review.
      return null;
    }
  };

  const elapsedStudySeconds = () => {
    const now = Date.now();
    const elapsed = Math.floor((now - lastStudyTickRef.current) / 1000);
    lastStudyTickRef.current = now;
    if (document.visibilityState !== "visible" || elapsed <= 0) return 0;
    return Math.min(elapsed, 60);
  };

  useEffect(() => {
    trackingActiveRef.current = Boolean(card);
    lastStudyTickRef.current = Date.now();
  }, [card?.id]);

  useEffect(() => {
    const flushStudyTime = async () => {
      if (!trackingActiveRef.current) return;
      await sendStudySeconds(elapsedStudySeconds());
    };

    const interval = window.setInterval(flushStudyTime, 15000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushStudyTime();
      } else {
        lastStudyTickRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      flushStudyTime();
    };
  }, []);

  useEffect(() => {
    setNoteText(card?.note ?? "");
    setNoteEditorOpen(false);
    setNoteMemoryOpen(false);
  }, [card?.id]);

  const submitAnswer = async (answer: WordAnswer) => {
    if (!card || submitting) return;
    triggerMemoryHaptic(answer);
    setSubmitting(true);
    setError("");
    try {
      const data = submitWordAnswer(card.id, answer, sessionOptions);
      let nextStats = data.stats;
      if (!data.card && trackingActiveRef.current) {
        trackingActiveRef.current = false;
        const trackedStats = await sendStudySeconds(elapsedStudySeconds());
        if (trackedStats) nextStats = trackedStats;
      }
      setCard(data.card);
      setStats(nextStats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const undo = async () => {
    setSubmitting(true);
    setError("");
    try {
      const data = undoLastWordAnswer();
      setCard(data.card);
      setStats(data.stats);
      setPhase(data.phase);
      setRevealed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤回失败");
    } finally {
      setSubmitting(false);
    }
  };

  const saveNote = async () => {
    if (!card || noteSaving) return;
    setNoteSaving(true);
    setError("");
    try {
      const data = updateWordNote(card.id, noteText);
      setCard((current) => current && current.id === data.wordId ? { ...current, note: data.note } : current);
      setNoteText(data.note);
      setNoteEditorOpen(false);
      setNoteMemoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "便签保存失败");
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleCardFavorite = () => {
    if (!card) return;
    setError("");
    try {
      const result = toggleFavorite("word", card.id);
      setCard({ ...card, isFavorite: result.isFavorite });
    } catch (err) {
      setError(err instanceof Error ? err.message : "收藏失败");
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-13rem)] min-h-[520px] max-w-4xl flex-col justify-center lg:h-[calc(100vh-4rem)] lg:min-h-[600px]">
      <section className="dictionary-card relative flex h-full min-h-0 flex-col rounded-2xl p-5 sm:p-8">
        <div className="mb-5 flex shrink-0 items-center justify-between gap-3 border-b border-white/15 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/65">Vocabulary</p>
            <h1 className="mt-1 text-xl font-semibold">单词学习</h1>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={selectedLevel}
                onChange={(event) => setSelectedLevel(event.target.value as WordLevelFilter)}
                className="focus-ring control-cyan soft-text-outline h-9 min-w-0 rounded-xl border px-2 text-xs font-bold"
                title="选择 JLPT 等级"
              >
                {levelOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as WordTypeFilter)}
                className="focus-ring control-cyan soft-text-outline h-9 min-w-0 rounded-xl border px-2 text-xs font-bold"
                title="选择词性或收藏"
              >
                {typeOptions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {progressText && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs text-white/70">{progressText}</span>}
            <button
              onClick={toggleCardFavorite}
              disabled={!card}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.isFavorite ? "bg-[#81D8CF] !text-[#2f3333]" : "bg-[#81D8CF]/10"}`}
              title={card?.isFavorite ? "取消收藏" : "收藏单词"}
            >
              <Star size={17} fill={card?.isFavorite ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => {
                setNoteMemoryOpen(false);
                setNoteEditorOpen((open) => !open);
              }}
              disabled={!card}
              className={`focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 hover:bg-[#81D8CF]/15 disabled:opacity-50 ${card?.note ? "bg-[#81D8CF]/20" : "bg-[#81D8CF]/10"}`}
              title={card?.note ? "编辑便签" : "添加便签"}
            >
              <StickyNote size={17} />
            </button>
            <button
              onClick={undo}
              disabled={submitting}
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/20 bg-[#81D8CF]/10 hover:bg-[#81D8CF]/15 disabled:opacity-50"
              title="上一个"
            >
              <RotateCcw size={17} />
            </button>
          </div>
        </div>

        {noteMemoryOpen && card?.note && (
          <div className="note-memory-card absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-2xl p-4 text-left sm:right-8 sm:top-24">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Memory Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteMemoryOpen(false)}
                className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-[#81D8CF]/15"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-white/88">{card.note}</p>
          </div>
        )}

        {noteEditorOpen && card && (
          <div className="absolute right-5 top-20 z-20 w-[min(380px,calc(100%-2.5rem))] rounded-2xl border border-white/20 bg-[#373b3b] p-4 text-left shadow-lg sm:right-8 sm:top-24">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">Word Note</p>
                <p className="jp mt-1 text-lg font-semibold">{cardLabel(card)}</p>
              </div>
              <button
                onClick={() => setNoteEditorOpen(false)}
                className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-36 w-full resize-none rounded-2xl border border-white/20 bg-[#2f3333] p-3 text-sm leading-6 text-white placeholder:text-white/45"
              placeholder="写下自己的记忆法、易混点、例句或吐槽..."
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-white/45">留空并保存即可清除便签</p>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                className="focus-ring rounded-2xl bg-[#81D8CF] px-4 py-2 text-sm font-bold !text-[#2f3333] disabled:opacity-50"
              >
                {noteSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#81D8CF]/40 bg-[#81D8CF]/20 p-4 text-sm text-white">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
              <p className="font-bold">暂时读不到本地词库</p>
              <p className="mt-1 text-white/75">请检查应用内是否包含 nihongo.db。</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[360px] place-items-center text-center text-white/75">正在读取下一题...</div>
        ) : card ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid min-h-28 shrink-0 place-items-center rounded-2xl border border-white/15 bg-[#464949] p-4 text-center">
              <div className="max-h-28 w-full overflow-y-auto px-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">题目</p>
                <p className="mt-2 break-words text-xl font-semibold leading-snug sm:text-3xl">
                  {card.promptMeaning || card.primaryMeaning}
                </p>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto rounded-2xl border border-white/15 bg-[#424545] p-6 text-center">
              {revealed ? (
                <div className="w-full">
                  <p className="jp-serif text-7xl font-semibold leading-none sm:text-8xl">
                    <KanjiAnswer card={card} />
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    {card.jlptLevel && <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/60">{card.jlptLevel}</span>}
                    <span className="rounded-sm bg-[#81D8CF]/10 px-2 py-1 text-xs font-bold text-white/60">{card.pos}</span>
                  </div>
                  <p className="jp mt-4 text-4xl text-white/86 sm:text-5xl">{secondaryAnswerText(card)}</p>
                  {preferences.showRomaji && romaji && (
                    <p className="mt-2 text-sm font-semibold tracking-normal text-white/52">{romaji}</p>
                  )}
                  <p className="mx-auto mt-7 max-w-2xl text-xl leading-9 text-white/82">{card.meaning}</p>
                  {(markedKanji.length > 0 || card.verbPair || card.confusions.length > 0) && (
                    <div className="mx-auto mt-7 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
                      {markedKanji.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">和式汉字</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {markedKanji.map((component) => (
                              <span
                                key={`${component.char}-${component.simplified}`}
                                className="inline-flex items-center gap-2 rounded-sm border border-[#81D8CF]/25 bg-[#81D8CF]/20 px-2.5 py-1.5 text-sm font-semibold"
                              >
                                <span className="jp-serif kanji-variant-mark text-xl leading-none">{component.char}</span>
                                <span className="text-white/45">→</span>
                                <span className="text-white/86">{component.simplified}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {card.verbPair && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">自他动词对应</p>
                          <div className="mt-3 flex items-baseline justify-between gap-3">
                            <span className="rounded-sm border border-white/15 px-2 py-1 text-xs font-bold text-white/70">{card.verbPair.pairVoice}</span>
                            <div className="text-right">
                              <p className="jp-serif text-2xl font-semibold leading-none">{card.verbPair.kanji}</p>
                              <p className="jp mt-1 text-base text-white/65">{card.verbPair.kana}</p>
                            </div>
                          </div>
                          {card.verbPair.meaning && <p className="mt-3 text-sm leading-6 text-white/75">{card.verbPair.meaning}</p>}
                          {card.verbPair.note && <p className="mt-2 text-xs leading-5 text-white/55">{card.verbPair.note}</p>}
                        </div>
                      )}

                      {card.confusions.length > 0 && (
                        <div className="rounded-2xl border border-white/15 bg-[#373b3b] p-4 sm:col-span-2">
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">易混词</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {card.confusions.slice(0, 3).map((item) => (
                              <div key={`${item.kind}-${item.kanji}-${item.kana}`} className="rounded-xl border border-white/10 bg-[#81D8CF]/10 p-3">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="jp-serif text-xl font-semibold leading-none">{item.kanji}</p>
                                  <span className="rounded-sm border border-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white/45">{item.kind}</span>
                                </div>
                                <p className="jp mt-1 text-sm text-white/58">{item.kana}</p>
                                <p className="mt-2 text-xs leading-5 text-white/70">{item.meaning}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-2xl font-semibold text-white/70">答案已隐藏</p>
                  <p className="mt-3 text-sm text-white/55">先回忆假名和汉字</p>
                </div>
              )}
            </div>

            <div className="h-16">
              {!revealed ? (
                <button
                  onClick={() => {
                    setRevealed(true);
                    setNoteEditorOpen(false);
                    if (card?.note) setNoteMemoryOpen(true);
                    if (card) playPronunciation(secondaryAnswerText(card));
                  }}
                  className="focus-ring inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#81D8CF] px-4 text-base font-bold !text-[#2f3333]"
                >
                  <Eye size={18} />
                  显示答案
                </button>
              ) : (
                <div className="grid h-16 grid-cols-4 gap-3">
                  {answerOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => submitAnswer(option.value)}
                      disabled={submitting}
                      className="focus-ring h-16 rounded-2xl border border-white/20 bg-[#81D8CF]/10 px-2 text-base font-bold hover:bg-[#81D8CF]/15 disabled:opacity-50"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <FinishPanel stats={stats} phase={phase} localSeconds={localStudySeconds} />
        )}
      </section>
    </div>
  );
};
