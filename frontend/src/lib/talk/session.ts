export interface TalkSession {
  keys: string[];
  queue: string[];
  cursor: number;
}

export const createTalkSession = (keys: string[]): TalkSession => {
  const unique = [...new Set(keys)];
  return { keys: unique, queue: unique, cursor: 0 };
};

/** 重来不计入分母；只在首次作答时追加，所以每张最多重来一次。 */
export const advanceTalkSession = (session: TalkSession, hints: number, gaveUp: boolean): TalkSession => {
  if (session.cursor >= session.queue.length) return session;
  const key = session.queue[session.cursor];
  const retry = (gaveUp || hints >= 2) && session.cursor < session.keys.length;
  return { ...session, cursor: session.cursor + 1, queue: retry ? [...session.queue, key] : session.queue };
};

export const talkSessionProgress = (session: TalkSession) => ({
  current: Math.min(session.cursor + 1, session.keys.length),
  total: session.keys.length
});
