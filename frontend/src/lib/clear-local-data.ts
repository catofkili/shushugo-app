/**
 * 「清除本机数据」共用的那一份实现。
 *
 * 之前设置页和隐私页各写各的 removeItem 清单:一处删 3 个键、一处删 4 个,
 * 而且两处都在删 `mn-word-level` / `mn-word-type` —— 这两个键**早就没有代码在写了**。
 * 真正活着的键一个都没删掉:学习模式、语法笔记、语法「熟悉/没记住」、快速学习草稿、
 * 语法等级筛选、阅读位置。点完「删除所有数据」再刷新回来,语法笔记原样还在。
 *
 * 根因是「一张手写的键名表」:新功能加键的时候没人会想起回来改它,于是这张表
 * 从写下来那天起就只会越来越不全。所以这里**按前缀扫**,不再列举键名 ——
 * 应用自己写的本机学习数据一律以 `mn-` 或 `jp-grammar-` 开头。
 *
 * 刻意留下的两类:
 *   - `mn_`(下划线)开头的账号会话、本机口令、通知计划。它们走 Capacitor
 *     Preferences,清学习数据不该顺手把人踢下线、也不该清掉已排好的系统通知。
 *     浏览器里 Preferences 还会再套一层 `CapacitorStorage.` 前缀,同样扫不到。
 *   - `mn-entitlements`(已购权益)交给调用方决定:隐私页的「删除所有数据」会另外
 *     调 clearEntitlements(),设置页的「清除学习数据」不碰已购内容。
 */
const CLEARED_PREFIXES = ["mn-", "jp-grammar-"];

/** 前缀命中但仍要留下的键,理由见上面的注释。 */
const KEPT_KEYS = new Set(["mn-entitlements"]);

/** 清掉本机的学习数据键,返回真正删掉的那些(方便调用方写日志/提示)。 */
export function clearLocalAppData(): string[] {
  const doomed: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || KEPT_KEYS.has(key)) continue;
      if (CLEARED_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    // 先收集再删:边遍历边 removeItem 会让索引塌陷,漏掉一半的键。
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // 隐私模式 / 存储被禁时读不到 localStorage。此时本来也没东西可清。
  }
  return doomed;
}
