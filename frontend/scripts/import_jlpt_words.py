from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "public" / "nihongo.db"
SEED_PATH = ROOT / "src" / "data" / "jlpt_words_seed.json"
SOURCE = ROOT.parents[1] / "japanese-learning-app" / "data" / "eggrolls_notes.csv"


def clean_text(text: str) -> str:
    return text.replace("<br>", "；").strip()


def has_ascii(text: str) -> bool:
    return any("A" <= char <= "Z" or "a" <= char <= "z" for char in text)


def has_katakana(text: str) -> bool:
    return any("\u30a0" <= char <= "\u30ff" for char in text)


def level_from_deck(deck: str) -> str | None:
    for level in ("N5", "N4", "N3", "N2", "N1"):
        if f"-{level}" in deck or f"::{level}" in deck:
            return level
    return None


def infer_verb_type(pos: str, kana: str, kanji: str) -> str | None:
    if "サ変" in pos or "する" in kanji or "する" in kana:
        return "suru"
    if "動" not in pos and "动" not in pos:
        return None
    base = kanji or kana
    if base in {"来る", "くる"}:
        return "kuru"
    if base in {"行く", "いく"}:
        return "iku"
    if base.endswith("る"):
        return "ichidan"
    return "godan"


def normalize_pos(pos: str, verb_type: str | None) -> str:
    if verb_type == "suru":
        return "名词・する动词"
    if "形動" in pos or "ナ形" in pos:
        return "な形容词"
    if "イ形" in pos:
        return "い形容词"
    if "動" in pos:
        return "动词"
    if "副" in pos:
        return "副词"
    if "名" in pos:
        return "名词"
    return pos or "词汇"


def estimate_importance(row: dict[str, str | int | None]) -> int:
    level = str(row["jlpt_level"])
    base = {"N5": 5, "N4": 5, "N3": 4, "N2": 3, "N1": 2}.get(level, 3)
    pos = str(row["pos"])
    if "动词" in pos or "形容词" in pos:
        base += 1
    if row.get("example_jp"):
        base += 1
    return max(1, min(base, 5))


def load_rows() -> list[dict[str, str | int | None]]:
    rows: list[dict[str, str | int | None]] = []
    with SOURCE.open(encoding="utf-8") as file:
        for source_index, raw in enumerate(csv.reader(file, delimiter="\t")):
            if not raw or raw[0].startswith("#") or len(raw) < 39:
                continue
            level = level_from_deck(raw[1])
            if not level:
                continue
            written, pos, reading, meaning = raw[3], raw[5], raw[6], raw[7]
            if not reading or not meaning:
                continue
            if has_ascii(reading) and has_katakana(written):
                kana, kanji = written, reading
            else:
                kana, kanji = reading, written or reading
            verb_type = infer_verb_type(pos, kana, kanji)
            row: dict[str, str | int | None] = {
                "meaning": clean_text(meaning),
                "kana": kana.strip(),
                "kanji": kanji.strip(),
                "pos": normalize_pos(pos, verb_type),
                "verb_type": verb_type,
                "example_jp": clean_text(raw[12]) if len(raw) > 12 else "",
                "example_meaning": clean_text(raw[14]) if len(raw) > 14 else "",
                "jlpt_level": level,
                "source_index": source_index,
            }
            row["importance"] = estimate_importance(row)
            rows.append(row)
    rank = {"N5": 1, "N4": 2, "N3": 3, "N2": 4, "N1": 5}
    rows.sort(key=lambda item: (rank[str(item["jlpt_level"])], int(item["source_index"])))
    return rows


def ensure_column(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(words)").fetchall()}
    if "jlpt_level" not in columns:
        conn.execute("ALTER TABLE words ADD COLUMN jlpt_level TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing source: {SOURCE}")
    rows = load_rows()
    SEED_PATH.write_text(
        json.dumps(
            [
                [
                    row["meaning"],
                    row["kana"],
                    row["kanji"],
                    row["pos"],
                    row["verb_type"],
                    row["importance"],
                    row["example_jp"],
                    row["example_meaning"],
                    row["jlpt_level"],
                ]
                for row in rows
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    with sqlite3.connect(DB_PATH) as conn:
      ensure_column(conn)
      existing = {
          (kanji, kana): word_id
          for word_id, kanji, kana in conn.execute("SELECT id, kanji, kana FROM words")
      }
      updated = 0
      inserted = 0
      for row in rows:
          key = (str(row["kanji"]), str(row["kana"]))
          existing_id = existing.get(key)
          if existing_id:
              conn.execute(
                  """
                  UPDATE words
                  SET jlpt_level = COALESCE(jlpt_level, ?),
                      importance = MAX(importance, ?)
                  WHERE id = ?
                  """,
                  (row["jlpt_level"], row["importance"], existing_id),
              )
              updated += 1
              continue
          cursor = conn.execute(
              """
              INSERT INTO words (
                meaning, kana, kanji, pos, verb_type, importance,
                shuffle_rank, example_jp, example_meaning, jlpt_level
              )
              VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?)
              """,
              (
                  row["meaning"],
                  row["kana"],
                  row["kanji"],
                  row["pos"],
                  row["verb_type"],
                  row["importance"],
                  row["example_jp"],
                  row["example_meaning"],
                  row["jlpt_level"],
              ),
          )
          existing[key] = cursor.lastrowid
          inserted += 1
      conn.execute("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words")
      conn.commit()
      counts = conn.execute(
          "SELECT jlpt_level, COUNT(*) FROM words GROUP BY jlpt_level ORDER BY jlpt_level"
      ).fetchall()
    print(f"Updated {updated}, inserted {inserted}, total {len(existing)}")
    print(counts)
    print(f"Wrote {SEED_PATH}")


if __name__ == "__main__":
    main()
