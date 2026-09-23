import { useLayoutEffect, useRef } from "react";
import { formatExamDate, parseExamDate, upcomingExamDates } from "../lib/jlpt/exam-dates";

const ROW_HEIGHT = 56;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ExamDateWheel({ value, onChange }: Props) {
  const upcoming = upcomingExamDates();
  const current = parseExamDate(value);
  const dates = current && !upcoming.some((date) => formatExamDate(date) === value) ? [current, ...upcoming] : upcoming;
  const wheel = useRef<HTMLDivElement>(null);
  const initialIndex = useRef(Math.max(0, dates.findIndex((date) => formatExamDate(date) === value)));

  useLayoutEffect(() => {
    if (wheel.current) wheel.current.scrollTop = initialIndex.current * ROW_HEIGHT;
  }, []);

  return (
    <div className="level-exam-wheel relative overflow-hidden rounded-2xl" aria-label="选择 JLPT 考试日期">
      <div ref={wheel} className="level-exam-wheel-scroll h-[168px] overflow-y-auto overscroll-contain py-14" onScroll={(event) => {
        const index = Math.min(dates.length - 1, Math.max(0, Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)));
        const next = formatExamDate(dates[index]);
        if (next !== value) onChange(next);
      }}>
        {dates.map((date, index) => {
          const dateValue = formatExamDate(date);
          const isCurrentOnly = !upcoming.some((entry) => formatExamDate(entry) === dateValue);
          const upcomingIndex = upcoming.findIndex((entry) => formatExamDate(entry) === dateValue);
          const position = isCurrentOnly ? "原来设置的日期" : upcomingIndex === 0 ? "下一次 JLPT 考试" : upcomingIndex === 1 ? "再下一次 JLPT 考试" : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月考试`;
          const estimated = !isCurrentOnly && date.getFullYear() > 2026;
          return <button key={dateValue} type="button" aria-pressed={value === dateValue} onClick={() => {
            onChange(dateValue);
            wheel.current?.scrollTo({ top: index * ROW_HEIGHT, behavior: "smooth" });
          }} className="level-exam-wheel-option focus-ring flex h-14 w-full snap-center items-center justify-between gap-2 px-4 text-left">
            <span className="truncate text-xs font-bold sm:text-sm">{position}</span>
            <span className="shrink-0 text-sm font-black">{date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日{estimated && <small className="ml-1 text-[11px] font-semibold">预计</small>}</span>
          </button>;
        })}
      </div>
    </div>
  );
}
