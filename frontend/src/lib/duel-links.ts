const validDuelId = (id: unknown): string | null => typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id) ? id : null;

/** 小程序入口传页面参数；网页仍只接受对战 URL，普通页面的 id 不当成对战。 */
export const duelIdFromUrl = (href: string, params?: { id?: unknown }): string | null => {
  if (params) return validDuelId(params.id);
  try {
    const url = new URL(href);
    return (url.pathname === "/study/duel/index" || url.searchParams.get("page") === "duel")
      ? validDuelId(url.searchParams.get("id")) : null;
  } catch { return null; }
};

export const duelSharePath = (id: string): string => `/study/duel/index?id=${encodeURIComponent(id)}`;
