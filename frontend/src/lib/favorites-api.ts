import { getDatabase } from "./database";
import { ensureUserTables, firstRow, isFavorite, persistSoon, rowsFor } from "./study-core";
import type { FavoriteItem, FavoriteType } from "./study-types";

export function toggleFavorite(type: FavoriteType, id: string | number): { isFavorite: boolean } {
  ensureUserTables();
  const db = getDatabase();
  const itemId = String(id);
  if (isFavorite(type, itemId)) {
    db.run("DELETE FROM content_favorites WHERE item_type = ? AND item_id = ?", [type, itemId]);
    persistSoon();
    return { isFavorite: false };
  }
  db.run(
    "INSERT OR IGNORE INTO content_favorites (item_type, item_id) VALUES (?, ?)",
    [type, itemId]
  );
  persistSoon();
  return { isFavorite: true };
}

export function getFavoriteItems(type: "all" | FavoriteType = "all"): FavoriteItem[] {
  ensureUserTables();
  const filter = type === "all" ? "" : "WHERE item_type = ?";
  const params = type === "all" ? [] : [type];
  const favorites = rowsFor(`
    SELECT item_type, item_id
    FROM content_favorites
    ${filter}
    ORDER BY created_at DESC
  `, params);

  return favorites.flatMap((favorite): FavoriteItem[] => {
    const itemType = String(favorite.item_type ?? "") as FavoriteType;
    const itemId = String(favorite.item_id ?? "");
    if (itemType === "word") {
      const row = firstRow("SELECT id, kanji, kana, meaning, pos FROM words WHERE id = ?", [Number(itemId)]);
      if (!row) return [];
      return [{
        type: itemType,
        id: itemId,
        title: String(row.kanji || row.kana || ""),
        subtitle: String(row.meaning ?? ""),
        meta: `${String(row.kana ?? "")}${row.pos ? ` · ${String(row.pos)}` : ""}`
      }];
    }
    if (itemType === "grammar") {
      const row = firstRow("SELECT pattern, prompt, meaning, level FROM grammar_points WHERE pattern = ?", [itemId]);
      if (!row) return [];
      return [{
        type: itemType,
        id: itemId,
        title: String(row.prompt || row.pattern || ""),
        subtitle: String(row.meaning ?? ""),
        meta: String(row.level ?? "")
      }];
    }
    return [];
  });
}
