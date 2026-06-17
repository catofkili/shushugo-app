import { Calendar, Check } from "lucide-react";
import { useEffect, useState } from "react";

interface CheckInData {
  [date: string]: boolean; // "2024-06-15": true
}

const STORAGE_KEY = "mn-checkin-data";

// 获取打卡数据
const getCheckInData = (): CheckInData => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

// 保存打卡数据
const saveCheckInData = (data: CheckInData) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// 获取今天的日期字符串 YYYY-MM-DD
const getTodayString = () => {
  const today = new Date();
  return today.toISOString().split("T")[0];
};

// 获取本月的所有日期
const getMonthDates = (year: number, month: number): Date[] => {
  const dates: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // 填充月初空白（周一到周日，周一为起始）
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // 转换为周一=0
  for (let i = 0; i < startDayOfWeek; i++) {
    const date = new Date(year, month, 1 - startDayOfWeek + i);
    dates.push(date);
  }

  // 填充本月所有日期
  for (let day = 1; day <= lastDay.getDate(); day++) {
    dates.push(new Date(year, month, day));
  }

  // 填充月末空白（补齐到完整周）
  const endDayOfWeek = (lastDay.getDay() + 6) % 7;
  const remainingDays = 6 - endDayOfWeek;
  for (let i = 1; i <= remainingDays; i++) {
    dates.push(new Date(year, month + 1, i));
  }

  return dates;
};

export function CheckInCalendar() {
  const [checkInData, setCheckInData] = useState<CheckInData>(getCheckInData);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [checkedToday, setCheckedToday] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const todayString = getTodayString();

  useEffect(() => {
    setCheckedToday(checkInData[todayString] === true);
  }, [checkInData, todayString]);

  // 打卡
  const handleCheckIn = () => {
    const newData = { ...checkInData, [todayString]: true };
    setCheckInData(newData);
    saveCheckInData(newData);
    setCheckedToday(true);
  };

  // 切换月份
  const changeMonth = (offset: number) => {
    setCurrentDate(new Date(year, month + offset, 1));
  };

  // 计算连续打卡天数
  const getStreakDays = (): number => {
    let streak = 0;
    const today = new Date();

    for (let i = 0; i < 365; i++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const dateString = date.toISOString().split("T")[0];

      if (checkInData[dateString]) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  // 计算本月打卡天数
  const getMonthCheckIns = (): number => {
    return getMonthDates(year, month).filter(date => {
      if (date.getMonth() !== month) return false;
      const dateString = date.toISOString().split("T")[0];
      return checkInData[dateString] === true;
    }).length;
  };

  const monthDates = getMonthDates(year, month);
  const streakDays = getStreakDays();
  const monthCheckIns = getMonthCheckIns();

  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  return (
    <div className="rounded-2xl border border-white/15 bg-[#464949] p-4">
      {/* 标题 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={20} className="text-[#81D8CF]" />
          <h3 className="text-lg font-bold text-white">每日打卡</h3>
        </div>

        {/* 今日打卡按钮 */}
        <button
          onClick={handleCheckIn}
          disabled={checkedToday}
          className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-all ${
            checkedToday
              ? "cursor-not-allowed bg-white/10 text-white/40"
              : "bg-[#81D8CF] text-[#343838] hover:bg-[#72c9c0]"
          }`}
        >
          {checkedToday ? "已打卡" : "打卡"}
        </button>
      </div>

      {/* 统计信息 */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[#81D8CF]/10 p-3 text-center">
          <p className="text-2xl font-bold text-[#81D8CF]">{streakDays}</p>
          <p className="mt-1 text-xs text-white/60">连续打卡</p>
        </div>
        <div className="rounded-lg bg-[#81D8CF]/10 p-3 text-center">
          <p className="text-2xl font-bold text-[#81D8CF]">{monthCheckIns}</p>
          <p className="mt-1 text-xs text-white/60">本月打卡</p>
        </div>
      </div>

      {/* 月份切换 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => changeMonth(-1)}
          className="rounded-lg px-2 py-1 text-sm font-bold text-white/70 hover:bg-[#81D8CF]/15"
        >
          ←
        </button>
        <span className="text-sm font-bold text-white">
          {year}年 {monthNames[month]}
        </span>
        <button
          onClick={() => changeMonth(1)}
          className="rounded-lg px-2 py-1 text-sm font-bold text-white/70 hover:bg-[#81D8CF]/15"
        >
          →
        </button>
      </div>

      {/* 日历 */}
      <div className="grid grid-cols-7 gap-1">
        {/* 星期标题 */}
        {weekDays.map((day) => (
          <div key={day} className="py-1 text-center text-xs font-bold text-white/50">
            {day}
          </div>
        ))}

        {/* 日期 */}
        {monthDates.map((date, index) => {
          const dateString = date.toISOString().split("T")[0];
          const isChecked = checkInData[dateString] === true;
          const isToday = dateString === todayString;
          const isCurrentMonth = date.getMonth() === month;

          return (
            <div
              key={index}
              className={`relative flex aspect-square items-center justify-center rounded-lg text-sm font-bold transition-all ${
                !isCurrentMonth
                  ? "text-white/20"
                  : isToday
                  ? "bg-[#81D8CF]/20 text-[#81D8CF] ring-2 ring-[#81D8CF]/50"
                  : isChecked
                  ? "bg-[#81D8CF]/30 text-white"
                  : "text-white/60 hover:bg-white/5"
              }`}
            >
              <span className="text-xs">{date.getDate()}</span>
              {isChecked && isCurrentMonth && (
                <Check
                  size={10}
                  className="absolute bottom-0.5 right-0.5 text-[#81D8CF]"
                  strokeWidth={3}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
