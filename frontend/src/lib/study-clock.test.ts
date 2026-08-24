import { describe, expect, it } from "vitest";
import {
  accrueStudyTime,
  createStudyClock,
  drainStudySeconds,
  noteStudyInteraction,
  STUDY_IDLE_LIMIT_MS
} from "./study-clock";

const visible = { visible: true };
const hidden = { visible: false };

const secondsAfter = (state: ReturnType<typeof createStudyClock>, nowMs: number, options = visible) =>
  drainStudySeconds(accrueStudyTime(state, nowMs, options)).seconds;

describe("学习时长记账", () => {
  it("一直在操作就一直计时", () => {
    let clock = createStudyClock(0);
    for (let tick = 1; tick <= 4; tick += 1) {
      clock = noteStudyInteraction(clock, tick * 15_000, visible);
    }
    expect(drainStudySeconds(clock).seconds).toBe(60);
  });

  it("空闲超过阈值之后的时间不算", () => {
    const clock = createStudyClock(0);
    // 十分钟没有任何操作:只认头 60 秒
    expect(secondsAfter(clock, 600_000)).toBe(STUDY_IDLE_LIMIT_MS / 1000);
  });

  it("走神回来不补算走神那段", () => {
    let clock = createStudyClock(0);
    // 走开五分钟，期间的定时结账把有效的 60 秒收掉
    clock = accrueStudyTime(clock, 300_000, visible);
    const first = drainStudySeconds(clock);
    expect(first.seconds).toBe(60);
    // 回来点一下 —— 这一下不能把刚才那五分钟追认成学习时长
    clock = noteStudyInteraction(first.state, 300_000, visible);
    clock = accrueStudyTime(clock, 310_000, visible);
    expect(drainStudySeconds(clock).seconds).toBe(10);
  });

  it("页面不可见时一秒都不记", () => {
    const clock = createStudyClock(0);
    expect(secondsAfter(clock, 30_000, hidden)).toBe(0);
  });

  it("高频事件的零头不会被抹掉", () => {
    let clock = createStudyClock(0);
    // 滚动每 100ms 来一次:每次都不足一秒,取整会把整场记成 0
    for (let step = 1; step <= 30; step += 1) {
      clock = noteStudyInteraction(clock, step * 100, visible);
    }
    expect(drainStudySeconds(clock).seconds).toBe(3);
  });

  it("取走整秒之后零头留在账上", () => {
    const clock = accrueStudyTime(createStudyClock(0), 2_400, visible);
    const drained = drainStudySeconds(clock);
    expect(drained.seconds).toBe(2);
    expect(drained.state.pendingMs).toBe(400);
  });
});
