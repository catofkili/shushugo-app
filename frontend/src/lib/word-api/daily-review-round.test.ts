import { describe, expect, it } from "vitest";
import { answerDailyReviewRound, createDailyReviewRound, dailyReviewRoundDone, nextDailyReviewId, roundWritesFsrs } from "./daily-review-round";

describe("集中拿下的锁定轮次", () => {
  const initial = () => createDailyReviewRound([1, 2, 3, 4]);
  it("待答时写 FSRS，答对一次后只做复查", () => {
    const round = initial();
    expect(roundWritesFsrs(round, 1)).toBe(true);
    const next = answerDailyReviewRound(round, 1, true);
    expect(next.words[0].status).toBe("once");
    expect(roundWritesFsrs(next, 1)).toBe(false);
    expect(round.words[0].status).toBe("pending");
  });
  it("待答时答错仍待答，下次继续写 FSRS", () => {
    const next = answerDailyReviewRound(initial(), 1, false);
    expect(next.words[0].status).toBe("pending");
    expect(roundWritesFsrs(next, 1)).toBe(true);
  });
  it("复查答对才算拿下", () => {
    const next = answerDailyReviewRound(answerDailyReviewRound(initial(), 1, true), 1, true);
    expect(next.words[0].status).toBe("done");
    expect(roundWritesFsrs(next, 1)).toBe(false);
  });
  it("复查答错回到待答，下次重新写 FSRS", () => {
    const next = answerDailyReviewRound(answerDailyReviewRound(initial(), 1, true), 1, false);
    expect(next.words[0].status).toBe("pending");
    expect(roundWritesFsrs(next, 1)).toBe(true);
  });
  it("跳过最近两张，按原顺序出非完成词", () => {
    let round = answerDailyReviewRound(initial(), 1, true);
    round = answerDailyReviewRound(round, 2, true);
    expect(round.recent).toEqual([1, 2]);
    expect(nextDailyReviewId(round)).toBe(3);
    round = answerDailyReviewRound(round, 3, true);
    expect(round.recent).toEqual([2, 3]);
    expect(nextDailyReviewId(round)).toBe(1);
  });
  it("只剩最近出的词时放宽间隔", () => {
    const round = answerDailyReviewRound(createDailyReviewRound([1]), 1, true);
    expect(nextDailyReviewId(round)).toBe(1);
  });
  it("第一张避开邀请前刚答的词", () => {
    expect(nextDailyReviewId(createDailyReviewRound([1, 2, 3], 1))).toBe(2);
  });
  it("全拿下后返回空并报告完成", () => {
    let round = createDailyReviewRound([1]);
    expect(dailyReviewRoundDone(round)).toBe(false);
    round = answerDailyReviewRound(answerDailyReviewRound(round, 1, true), 1, true);
    expect(dailyReviewRoundDone(round)).toBe(true);
    expect(nextDailyReviewId(round)).toBeNull();
  });
  it("忽略已完成或不在锁定批次的作答", () => {
    const round = initial();
    expect(answerDailyReviewRound(round, 99, true)).toBe(round);
    expect(roundWritesFsrs(round, 99)).toBe(false);
    const done = answerDailyReviewRound(answerDailyReviewRound(round, 1, true), 1, true);
    expect(answerDailyReviewRound(done, 1, false)).toBe(done);
  });
});
