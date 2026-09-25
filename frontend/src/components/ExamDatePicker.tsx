import { useState } from "react";
import { announcedExamDates, examLabel, formatExamDate, formatExamDateHuman, nextGaokaoDate, parseExamDate, upcomingExamDates, type ExamKind } from "../lib/jlpt/exam-dates";

interface Props {
  kind: ExamKind;
  value: string;
  onChange: (value: string) => void;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function ExamDatePicker({ kind, value, onChange }: Props) {
  const selected = parseExamDate(value);
  const firstYear = kind === "gaokao" ? nextGaokaoDate().getFullYear() : new Date().getFullYear();
  const [open, setOpen] = useState(!selected);
  const [year, setYear] = useState(selected?.getFullYear() ?? firstYear);
  const [month, setMonth] = useState(kind === "gaokao" ? 6 : (selected?.getMonth() ?? new Date().getMonth()) + 1);
  const years = Array.from({ length: 5 }, (_, index) => firstYear + index);
  const visibleYear = years.includes(year) ? year : years[0];
  const visibleMonth = kind === "gaokao" ? 6 : month;
  const firstWeekday = new Date(visibleYear, visibleMonth - 1, 1).getDay();
  const dayCount = new Date(visibleYear, visibleMonth, 0).getDate();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const presets = kind === "jlpt" ? upcomingExamDates().slice(0, 4) : announcedExamDates(kind).slice(0, 4);
  const choose = (date: Date) => { onChange(formatExamDate(date)); setOpen(false); };

  return <div className="overflow-hidden rounded-2xl border border-[#d7cbb8] bg-white/80 text-[#352c23]">
    <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="flex min-w-0 flex-col"><strong>{selected ? `${selected.getFullYear()} 年 ${formatExamDateHuman(selected)}` : "选择考试日期"}</strong><small className="text-xs text-[#746250]">{selected ? examLabel(kind) : "请按考点或准考信息选择日期"}</small></span>
      <span className="shrink-0 rounded-full bg-[#e8f2dc] px-3 py-1 text-xs font-bold text-[#497333]">{open ? "收起 ↑" : "修改日期 ↓"}</span>
    </button>
    {open && <div className="border-t border-[#e6dcca] p-3">
      {presets.length > 0 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {presets.map((date) => <button key={formatExamDate(date)} type="button" className="ls-option shrink-0 px-3 py-2 text-xs" onClick={() => choose(date)}>
          {formatExamDateHuman(date)}{kind === "jlpt" && date.getFullYear() > 2026 ? " · 预计" : " · 已公布"}
        </button>)}
      </div>}
      <p className="mb-2 text-xs leading-5 text-[#746250]">
        {kind === "gaokao" ? "高考日语日期以准考证为准；默认日期仅作占位，可在日历中修改。" : kind === "bjt" ? "BJT 按预约考位选择实际考试日期。" : kind === "nat" ? "NAT-TEST 场次因地区而异，请按本地考点公告选择。" : kind === "kaoyan" ? "请按当年研考通知选择日语科目日期。" : "请按报名地区和考点公告确认考试日期。"}
      </p>
      <div className="mb-3 flex gap-1" aria-label="选择年份">
        {years.map((entry) => <button key={entry} type="button" aria-pressed={visibleYear === entry} onClick={() => setYear(entry)} className="ls-option min-h-9 flex-1 px-1 text-xs">{entry}</button>)}
      </div>
      {kind !== "gaokao" && <label className="mb-3 flex items-center gap-2 text-xs font-bold text-[#62584b]">月份
        <select value={visibleMonth} onChange={(event) => setMonth(Number(event.target.value))} className="rounded-lg border border-[#d5c9b7] bg-white px-2 py-1 text-sm">
          {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 月</option>)}
        </select>
      </label>}
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${visibleYear} 年 ${visibleMonth} 月日期`}>
        {WEEKDAYS.map((day) => <span key={day} className="py-1 text-center text-xs font-bold text-[#8b8173]">{day}</span>)}
        {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: dayCount }, (_, index) => {
          const date = new Date(visibleYear, visibleMonth - 1, index + 1);
          const dateValue = formatExamDate(date);
          return <button key={dateValue} type="button" aria-label={`${visibleYear} 年 ${visibleMonth} 月 ${index + 1} 日`} aria-pressed={value === dateValue} disabled={date < todayStart} className="min-h-9 rounded-lg bg-[#f5f1e9] text-xs font-bold aria-pressed:bg-[#94c76e] aria-pressed:text-[#193015] disabled:opacity-30" onClick={() => choose(date)}>{index + 1}</button>;
        })}
      </div>
    </div>}
  </div>;
}
