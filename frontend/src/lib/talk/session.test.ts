import { describe, expect, it } from "vitest";
import { advanceTalkSession, createTalkSession, talkSessionProgress } from "./session";

describe("开口练习一场的队列", () => {
  it("原卡去重，答错和两次提示追加到场末，每张最多重来一次，分母不变", () => {
    const original = createTalkSession(["a", "b", "a", "c"]);
    expect(original.queue).toEqual(["a", "b", "c"]);
    let session = advanceTalkSession(original, 0, true);
    expect(session.queue).toEqual(["a", "b", "c", "a"]);
    session = advanceTalkSession(session, 2, false);
    expect(session.queue).toEqual(["a", "b", "c", "a", "b"]);
    session = advanceTalkSession(session, 1, false);
    expect(talkSessionProgress(session)).toEqual({ current: 3, total: 3 });
    session = advanceTalkSession(session, 3, true);
    session = advanceTalkSession(session, 2, false);
    expect(session.cursor).toBe(session.queue.length);
    expect(session.queue).toHaveLength(5);
    expect(advanceTalkSession(session, 2, true)).toBe(session);
    // 页面撤销保留的是作答前的纯状态；追加不能修改旧队列。
    expect(original).toEqual({ keys: ["a", "b", "c"], queue: ["a", "b", "c"], cursor: 0 });
  });

  it("零次和一次提示不重来，空场直接结束", () => {
    let session = createTalkSession(["a", "b"]);
    expect(talkSessionProgress(session)).toEqual({ current: 1, total: 2 });
    session = advanceTalkSession(session, 0, false);
    expect(talkSessionProgress(session)).toEqual({ current: 2, total: 2 });
    session = advanceTalkSession(session, 1, false);
    expect(session.queue).toEqual(["a", "b"]);
    expect(session.cursor).toBe(2);
    const empty = createTalkSession([]);
    expect(advanceTalkSession(empty, 2, true)).toBe(empty);
  });
});
