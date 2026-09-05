import { getDatabase } from "./database";
import { ensureUserTables, firstRow, firstValue, getState, isFavorite, persistSoon, rowsFor, setState } from "./study-core";
import type { FavoriteFolder, FavoriteItem, FavoriteType } from "./study-types";

/** 未分类。空字符串而不是 NULL：收藏夹是一列 TEXT，比较和分组都不用管三值逻辑。 */
export const UNFILED_FOLDER = "";
export const FOLDER_NAME_MAX = 20;

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, FOLDER_NAME_MAX);

/**
 * 收藏夹清单 = 建过的夹子 ∪ 收藏行上出现过的夹名。
 *
 * 后半段不是冗余：另一台设备删掉夹子、这台还有收藏挂在上面时（favorite_folders
 * 走 union 合并，删除靠墓碑），光看 favorite_folders 会让那些收藏凭空消失在
 * 「全部」以外的任何视图里。以夹名为准就自愈。
 */
export function listFavoriteFolders(): FavoriteFolder[] {
  ensureUserTables();
  const rows = rowsFor(`
    SELECT name, COALESCE(n, 0) AS n, created_at FROM (
      SELECT f.name AS name, c.n AS n, f.created_at AS created_at
      FROM favorite_folders f
      LEFT JOIN (SELECT folder, COUNT(*) AS n FROM content_favorites GROUP BY folder) c
        ON c.folder = f.name
      UNION
      SELECT folder, COUNT(*), '' FROM content_favorites
      WHERE folder <> '' AND folder NOT IN (SELECT name FROM favorite_folders)
      GROUP BY folder
    )
    ORDER BY created_at ASC, name ASC
  `);
  return rows.map((row) => ({ name: String(row.name ?? ""), count: Number(row.n ?? 0) }));
}

/**
 * 上次收进了哪个夹子。成熟产品（Pinterest 把最近用过的板置顶、B 站记住上次那个）
 * 都在解决同一件事：分好类的人几乎总是连着往同一个夹子里放。这里只用来在选择框上
 * 标一个「上次」，**不改顺序** —— 位置一动，肌肉记忆就废了。
 */
const LAST_FOLDER_KEY = "favorite_last_folder";

export function lastFavoriteFolder(): string {
  ensureUserTables();
  return getState(LAST_FOLDER_KEY, UNFILED_FOLDER);
}

export function unfiledFavoriteCount(): number {
  ensureUserTables();
  return firstValue<number>("SELECT COUNT(*) FROM content_favorites WHERE folder = ''", [], 0);
}

export function createFavoriteFolder(name: string): string {
  ensureUserTables();
  const clean = cleanName(name);
  if (!clean) return "";
  getDatabase().run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)", [clean]);
  persistSoon();
  return clean;
}

export function renameFavoriteFolder(from: string, to: string): string {
  ensureUserTables();
  const clean = cleanName(to);
  if (!clean || clean === from) return from;
  const db = getDatabase();
  db.run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)", [clean]);
  db.run("DELETE FROM favorite_folders WHERE name = ?", [from]);
  db.run("UPDATE content_favorites SET folder = ? WHERE folder = ?", [clean, from]);
  persistSoon();
  return clean;
}

/** 删夹子不删收藏：里面的东西回到未分类。 */
export function deleteFavoriteFolder(name: string): void {
  ensureUserTables();
  const db = getDatabase();
  db.run("UPDATE content_favorites SET folder = '' WHERE folder = ?", [name]);
  db.run("DELETE FROM favorite_folders WHERE name = ?", [name]);
  persistSoon();
}

export function setFavoriteFolder(type: FavoriteType, id: string | number, folder: string): void {
  ensureUserTables();
  getDatabase().run(
    "UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",
    [folder, type, String(id)]
  );
  persistSoon();
}

/** 已收藏的词再点一次只改夹子，不会被当成「取消收藏」。 */
export function addFavorite(type: FavoriteType, id: string | number, folder = UNFILED_FOLDER): void {
  ensureUserTables();
  const db = getDatabase();
  const itemId = String(id);
  db.run(
    "INSERT OR IGNORE INTO content_favorites (item_type, item_id, folder) VALUES (?, ?, ?)",
    [type, itemId, folder]
  );
  db.run(
    "UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",
    [folder, type, itemId]
  );
  setState(LAST_FOLDER_KEY, folder);
  persistSoon();
}

export function addFavorites(type: FavoriteType, ids: (string | number)[], folder = UNFILED_FOLDER): number {
  ids.forEach((id) => addFavorite(type, id, folder));
  return ids.length;
}

export function toggleFavorite(type: FavoriteType, id: string | number, folder = UNFILED_FOLDER): { isFavorite: boolean } {
  ensureUserTables();
  const itemId = String(id);
  if (isFavorite(type, itemId)) {
    getDatabase().run("DELETE FROM content_favorites WHERE item_type = ? AND item_id = ?", [type, itemId]);
    persistSoon();
    return { isFavorite: false };
  }
  addFavorite(type, itemId, folder);
  return { isFavorite: true };
}

/** folder: undefined = 不筛；传夹名（含 "" 未分类）只看那一夹。 */
export function getFavoriteItems(type: "all" | FavoriteType = "all", folder?: string): FavoriteItem[] {
  ensureUserTables();
  const clauses: string[] = [];
  const params: string[] = [];
  if (type !== "all") {
    clauses.push("item_type = ?");
    params.push(type);
  }
  if (folder !== undefined) {
    clauses.push("folder = ?");
    params.push(folder);
  }
  const favorites = rowsFor(`
    SELECT item_type, item_id, folder
    FROM content_favorites
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY created_at DESC
  `, params);

  return favorites.flatMap((favorite): FavoriteItem[] => {
    const itemType = String(favorite.item_type ?? "") as FavoriteType;
    const itemId = String(favorite.item_id ?? "");
    const folderName = String(favorite.folder ?? "");
    if (itemType === "word") {
      const row = firstRow("SELECT id, kanji, kana, meaning, pos FROM words WHERE id = ?", [Number(itemId)]);
      if (!row) return [];
      return [{
        type: itemType,
        id: itemId,
        folder: folderName,
        title: String(row.kanji || row.kana || ""),
        subtitle: String(row.meaning ?? ""),
        meta: `${String(row.kana ?? "")}${row.pos ? ` · ${String(row.pos)}` : ""}`
      }];
    }
    if (itemType === "grammar") {
      const row = firstRow(`
        SELECT g.pattern, g.prompt, g.meaning, g.level,
          (SELECT COUNT(*) FROM grammar_points same_level
           WHERE same_level.level = g.level AND same_level.sort_order <= g.sort_order) AS level_ordinal
        FROM grammar_points g
        WHERE g.pattern = ?
      `, [itemId]);
      // ⚠️ **查不到不能丢掉这一行。** 语法收藏存的是 grammar.ts 的字符串 id
      // （pdf-n5-001），而这张表只认 pattern —— 于是从语法列表收藏的东西
      // 在收藏页一条都显示不出来（一直如此，直到收藏夹的计数把它照出来：
      // 角标写着 3、列表只有 2 条）。id 是全应用的语法身份，不改；
      // 这里把行原样交出去，标题留空，由页面拿 grammar.ts 补齐（那份数据在
      // 语法 chunk 里，按需 import，不进主包）。
      if (!row) {
        return [{ type: itemType, id: itemId, folder: folderName, title: "", subtitle: "", meta: "" }];
      }
      return [{
        type: itemType,
        id: itemId,
        folder: folderName,
        title: String(row.prompt || row.pattern || ""),
        subtitle: String(row.meaning ?? ""),
        meta: `${String(row.level ?? "")} · ${String(Number(row.level_ordinal ?? 0)).padStart(3, "0")}`
      }];
    }
    return [];
  });
}
