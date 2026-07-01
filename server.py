from __future__ import annotations

import json
import random
import re
import sqlite3
import csv
from datetime import date, datetime, time, timedelta
from difflib import SequenceMatcher
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from seed_words import WORDS
from seed_grammar import GRAMMAR_DATASET_VERSION, GRAMMAR_POINTS

try:
    import kanasim  # type: ignore
except ImportError:
    kanasim = None

# 振假名(注音):用 pykakasi 给汉字段生成读音,输出 ⟪汉字｜よみ⟫ 标记,前端 JapaneseRuby 渲染成 <ruby>。
# 没装库时优雅降级(原样返回,不报错)。
try:
    import pykakasi  # type: ignore
    _KKS = pykakasi.kakasi()
except Exception:  # pragma: no cover
    _KKS = None

_KANJI_RE = re.compile(r"[㐀-䶿一-鿿々〇]")
_KANA_RE = re.compile(r"[ぁ-んァ-ヶー]")
# 括号内多为中文释义(如 ～のに（明明……却……）),不能用日文读音注音,整段跳过
_PAREN_RE = re.compile(r"（[^（）]*）|\([^()]*\)")


def _furigana_segment(text: str) -> str:
    parts: list[str] = []
    for item in _KKS.convert(text):
        orig = item.get("orig", "")
        hira = item.get("hira", "")
        if orig and hira and orig != hira and _KANJI_RE.search(orig):
            parts.append(f"⟪{orig}｜{hira}⟫")
        else:
            parts.append(orig)
    return "".join(parts)


@lru_cache(maxsize=8192)
def furigana(text: str | None) -> str:
    """给括号外的日文片段套上 ⟪原文｜读音⟫ 注音标记;括号内(中文释义)与无库时原样返回。"""
    if not text or _KKS is None:
        return text or ""
    out: list[str] = []
    last = 0
    for m in _PAREN_RE.finditer(text):
        out.append(_furigana_segment(text[last:m.start()]))
        out.append(m.group(0))  # 括号内原样保留
        last = m.end()
    out.append(_furigana_segment(text[last:]))
    return "".join(out)


def _strip_cn_parens(text: str) -> str:
    """删除"含汉字且无假名"的括号(多为中文释义/等级标记),保留读音/日文括号。"""
    prev = None
    while prev != text:
        prev = text
        def repl(m: "re.Match[str]") -> str:
            inner = m.group(0)[1:-1]
            return "" if (_KANJI_RE.search(inner) and not _KANA_RE.search(inner)) else m.group(0)
        text = _PAREN_RE.sub(repl, text)
    return text.strip()


def clean_grammar_title(pattern: str | None, prompt: str | None) -> str:
    """出题显示用:去掉题目里泄露答案的中文释义/等级,只保留干净的日语语法形。"""
    pattern = pattern or ""
    prompt = prompt or ""
    # A 类:prompt 是 pattern 的干净前缀(pattern = prompt +（N?・释义）)→ 用 prompt
    base = prompt if (prompt and pattern != prompt and pattern.startswith(prompt)) else pattern
    cleaned = _strip_cn_parens(base)
    return cleaned or pattern


def grammar_question_prompt(meaning: str | None) -> str:
    """语法练习题目页只给中文线索,不要泄露假名语法形。"""
    text = meaning or "请回忆对应语法"
    text = _KANA_RE.sub("", text)
    text = re.sub(r"[／/・]+", "、", text)
    text = re.sub(r"「\s*」|『\s*』|（\s*）|\(\s*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip(" 、，。；:：")
    return text or "请回忆对应语法"


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "japanese_words.sqlite3"
KANJI_VARIANTS_PATH = BASE_DIR / "data" / "kanji_variants.json"
ENGLISH_ORIGINS_PATH = BASE_DIR / "data" / "english_origins.json"
VERB_PAIR_HINTS_PATH = BASE_DIR / "data" / "verb_pair_hints.json"
EGGROLLS_NOTES_PATH = BASE_DIR / "data" / "eggrolls_notes.csv"
DAY_ROLLOVER = time(hour=4)
CRITICAL_SCORE = -20
AUTO_DECAY_FLOOR = -10
MOJI_MIGRATION_REVIEW_CAP = 30
KANJI_VARIANTS_CACHE: dict[str, str] | None = None
ENGLISH_ORIGINS_CACHE: dict[str, str] | None = None
VERB_PAIR_HINTS_CACHE: dict[str, tuple[str, str, str, str]] | None = None

NOUN_SURU_CORRECTIONS = {
    ("運動", "うんどう"),
    ("計画", "けいかく"),
    ("研究", "けんきゅう"),
    ("故障", "こしょう"),
    ("授業", "じゅぎょう"),
    ("生活", "せいかつ"),
    ("選択", "せんたく"),
    ("卒業", "そつぎょう"),
    ("留学", "りゅうがく"),
    ("旅行", "りょこう"),
    ("練習", "れんしゅう"),
    ("連絡", "れんらく"),
    ("遅刻", "ちこく"),
    ("出発", "しゅっぱつ"),
    ("到着", "とうちゃく"),
    ("見学", "けんがく"),
    ("復習", "ふくしゅう"),
    ("予習", "よしゅう"),
    ("予約", "よやく"),
    ("翻訳", "ほんやく"),
    ("信号", "しんごう"),
    ("洗濯", "せんたく"),
    ("勉強", "べんきょう"),
    ("活動", "かつどう"),
    ("帰国", "きこく"),
    ("挨拶", "あいさつ"),
    ("営業", "えいぎょう"),
    ("希望", "きぼう"),
    ("成功", "せいこう"),
    ("入学", "にゅうがく"),
    ("約束", "やくそく"),
    ("利用", "りよう"),
    ("急行", "きゅうこう"),
    ("協力", "きょうりょく"),
    ("教育", "きょういく"),
    ("緊張", "きんちょう"),
    ("行動", "こうどう"),
    ("信用", "しんよう"),
    ("努力", "どりょく"),
    ("輸出", "ゆしゅつ"),
    ("輸入", "ゆにゅう"),
    ("冷蔵", "れいぞう"),
    ("朝寝坊", "あさねぼう"),
    ("誕生", "たんじょう"),
    ("飲食", "いんしょく"),
    ("出張", "しゅっちょう"),
    ("ごちそう", "ごちそう"),
    ("影響", "えいきょう"),
    ("遠足", "えんそく"),
    ("学習", "がくしゅう"),
    ("観光", "かんこう"),
    ("競争", "きょうそう"),
    ("見物", "けんぶつ"),
    ("合格", "ごうかく"),
    ("集合", "しゅうごう"),
    ("体操", "たいそう"),
    ("暖房", "だんぼう"),
    ("報告", "ほうこく"),
    ("放送", "ほうそう"),
    ("提出", "ていしゅつ"),
    ("転職", "てんしょく"),
    ("優勝", "ゆうしょう"),
    ("外出", "がいしゅつ"),
    ("研修", "けんしゅう"),
    ("広告", "こうこく"),
    ("残業", "ざんぎょう"),
    ("就職", "しゅうしょく"),
    ("彫刻", "ちょうこく"),
    ("流行", "りゅうこう"),
    ("担当", "たんとう"),
    ("企画", "きかく"),
    ("泥棒", "どろぼう"),
    ("看病", "かんびょう"),
}


def study_date() -> date:
    now = datetime.now()
    if now.time() < DAY_ROLLOVER:
        return (now - timedelta(days=1)).date()
    return now.date()


TODAY = lambda: study_date().isoformat()

HIGH_IMPORTANCE_HINTS = {
    "動詞",
    "动词",
    "する动词",
    "な形容词",
    "名词・する动词",
}


def create_kana_distance():
    if not kanasim:
        return None
    try:
        return kanasim.create_kana_distance_calculator()
    except Exception:
        return None


KANA_DISTANCE = create_kana_distance()

GODAN = {
    "う": ("い", "わ", "った", "って"),
    "く": ("き", "か", "いた", "いて"),
    "ぐ": ("ぎ", "が", "いだ", "いで"),
    "す": ("し", "さ", "した", "して"),
    "つ": ("ち", "た", "った", "って"),
    "ぬ": ("に", "な", "んだ", "んで"),
    "ぶ": ("び", "ば", "んだ", "んで"),
    "む": ("み", "ま", "んだ", "んで"),
    "る": ("り", "ら", "った", "って"),
}

VERB_PAIR_HINTS = {
    "開ける": ("他动词", "開く", "あく", "自动词：门、店等自己开着/开了"),
    "開く": ("自动词", "開ける", "あける", "他动词：把门、窗等打开"),
    "閉める": ("他动词", "閉まる", "しまる", "自动词：门、店等自己关着/关了"),
    "閉まる": ("自动词", "閉める", "しめる", "他动词：把门、窗等关上"),
    "入れる": ("他动词", "入る", "はいる", "自动词：进入、装进去了"),
    "入る": ("自动词", "入れる", "いれる", "他动词：把东西放进去"),
    "出す": ("他动词", "出る", "でる", "自动词：出来、出去、出现"),
    "出る": ("自动词", "出す", "だす", "他动词：拿出、提交、发出"),
    "付ける": ("他动词", "付く", "つく", "自动词：附着、灯亮、带有"),
    "付く": ("自动词", "付ける", "つける", "他动词：贴上、打开灯、加上"),
    "消す": ("他动词", "消える", "きえる", "自动词：消失、熄灭"),
    "消える": ("自动词", "消す", "けす", "他动词：关掉、擦掉、消除"),
    "壊す": ("他动词", "壊れる", "こわれる", "自动词：坏了"),
    "壊れる": ("自动词", "壊す", "こわす", "他动词：弄坏"),
    "落とす": ("他动词", "落ちる", "おちる", "自动词：掉落、落下"),
    "落ちる": ("自动词", "落とす", "おとす", "他动词：使掉下、弄丢"),
    "止める": ("他动词", "止まる", "とまる", "自动词：停下"),
    "止まる": ("自动词", "止める", "とめる", "他动词：使停下、停止"),
    "始める": ("他动词", "始まる", "はじまる", "自动词：开始"),
    "始まる": ("自动词", "始める", "はじめる", "他动词：开始做"),
    "終える": ("他动词", "終わる", "おわる", "自动词：结束"),
    "終わる": ("自动词", "終える", "おえる", "他动词：完成、结束某事"),
    "変える": ("他动词", "変わる", "かわる", "自动词：变化"),
    "変わる": ("自动词", "変える", "かえる", "他动词：改变"),
    "集める": ("他动词", "集まる", "あつまる", "自动词：聚集"),
    "集まる": ("自动词", "集める", "あつめる", "他动词：收集、召集"),
}


def verb_voice(text: str) -> str | None:
    if "他動" in text or "他动" in text:
        return "他动词"
    if "自動" in text or "自动" in text:
        return "自动词"
    return None


def kana_from_markup(text: str) -> str:
    return re.sub(r"([一-龯々〆ヵヶ]+)\[([^\]]+)\]", r"\2", text).strip()


def strip_voice_label(text: str) -> str:
    return re.sub(r"^［[自他]動］", "", text).strip()


def load_static_verb_pair_hints() -> dict[str, tuple[str, str, str, str]]:
    if not VERB_PAIR_HINTS_PATH.exists():
        return {}
    try:
        with VERB_PAIR_HINTS_PATH.open(encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    hints: dict[str, tuple[str, str, str, str]] = {}
    if not isinstance(payload, dict):
        return hints
    for key, value in payload.items():
        if isinstance(key, str) and isinstance(value, list) and len(value) >= 4:
            hints[key] = (str(value[0]), str(value[1]), str(value[2]), str(value[3]))
    return hints


def eggrolls_verb_pair_hints() -> dict[str, tuple[str, str, str, str]]:
    global VERB_PAIR_HINTS_CACHE
    if VERB_PAIR_HINTS_CACHE is not None:
        return VERB_PAIR_HINTS_CACHE

    hints = load_static_verb_pair_hints()
    if not EGGROLLS_NOTES_PATH.exists():
        VERB_PAIR_HINTS_CACHE = hints
        return hints

    with EGGROLLS_NOTES_PATH.open(encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter="\t")
        for row in reader:
            if len(row) < 9 or row[0].startswith("#"):
                continue
            word_kanji = row[3].strip()
            word_kana = row[6].strip()
            meaning = row[7].strip()
            voice = verb_voice(row[5])
            if not word_kanji or not word_kana or not voice:
                continue
            for index, value in enumerate(row):
                if value.strip() not in {"関", "関連"} or index + 4 >= len(row):
                    continue
                pair_kanji = row[index + 1].strip()
                pair_kana = kana_from_markup(row[index + 2].strip())
                pair_meaning = row[index + 3].strip()
                pair_voice = verb_voice(pair_meaning)
                if not pair_kanji or not pair_kana or not pair_voice or pair_voice == voice:
                    continue
                hints.setdefault(word_kanji, (voice, pair_kanji, pair_kana, f"{pair_voice}：{strip_voice_label(pair_meaning)}"))
                hints.setdefault(pair_kanji, (pair_voice, word_kanji, word_kana, f"{voice}：{meaning}"))

    hints.update(VERB_PAIR_HINTS)
    VERB_PAIR_HINTS_CACHE = hints
    return hints

SENSE_GROUPS = [
    {
        "keys": {"食べる", "たべる", "召し上がる", "めしあがる", "頂く", "いただく", "食う", "くう"},
        "items": [
            ("食べる", "たべる", "普通说法：吃。最中性，日常最常用。"),
            ("召し上がる", "めしあがる", "尊敬语：别人吃/喝。抬高对方。"),
            ("頂く", "いただく", "谦让语：我吃/喝；也可表示得到。降低自己。"),
            ("食う", "くう", "粗俗/男性化口语：吃。词库没有也给你作辨析参考。"),
        ],
    },
    {
        "keys": {"見る", "みる", "見える", "みえる", "見せる", "みせる"},
        "items": [
            ("見る", "みる", "主动看。"),
            ("見える", "みえる", "能看见/映入眼帘，偏自动。"),
            ("見せる", "みせる", "给别人看，偏他动。"),
        ],
    },
    {
        "keys": {"聞く", "きく", "聞こえる", "きこえる"},
        "items": [
            ("聞く", "きく", "主动听；也可表示询问。"),
            ("聞こえる", "きこえる", "听得见，声音自然传入耳中。"),
        ],
    },
]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    if column not in table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def estimate_importance(word: sqlite3.Row | dict) -> int:
    kana = word["kana"]
    kanji = word["kanji"]
    pos = word["pos"]
    importance = 3
    if any(hint in pos for hint in HIGH_IMPORTANCE_HINTS):
        importance += 1
    if len(kana) <= 4:
        importance += 1
    if kanji and kanji != kana and len(kanji) <= 3:
        importance += 1
    if "外来" in pos or "カタカナ" in pos:
        importance -= 1
    return min(max(importance, 1), 5)


def has_ascii(text: str) -> bool:
    return any("A" <= char <= "Z" or "a" <= char <= "z" for char in text)


def has_katakana(text: str) -> bool:
    return any("\u30a0" <= char <= "\u30ff" for char in text)


def english_origins() -> dict[str, str]:
    global ENGLISH_ORIGINS_CACHE
    if ENGLISH_ORIGINS_CACHE is None:
        try:
            ENGLISH_ORIGINS_CACHE = json.loads(ENGLISH_ORIGINS_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            ENGLISH_ORIGINS_CACHE = {}
    return ENGLISH_ORIGINS_CACHE


def english_origin(kanji: str, kana: str, meaning: str) -> str:
    if not has_katakana(f"{kanji}{kana}"):
        return ""
    mapped = english_origins().get(kanji) or english_origins().get(kana)
    if mapped:
        return mapped
    non_english_marker = r"^\s*[（(\[]\s*(?:法|フ|仏|德|独|オ|蘭|葡|ポ|伊|イ|露|ロ)\s*[）)\]]"
    if has_ascii(kanji):
        for part in re.split(r"[；;]", kanji):
            if has_ascii(part) and not re.search(non_english_marker, part):
                return part.strip()
        return ""
    if re.search(non_english_marker, meaning or ""):
        return ""
    candidates = re.findall(r"[A-Za-z]+(?:[ .'-]+[A-Za-z]+)*", meaning or "")
    return candidates[0].strip(" .;,-") if candidates else ""


def question_meaning(meaning: str) -> str:
    """Keep the Chinese definition while hiding English and kana on the prompt."""
    # Remove long English words (3+ chars), keep short letter+CJK combos like T恤, A型
    text = re.sub(r"[A-Za-zＡ-Ｚａ-ｚ]{3,}(?:[ ./'-]+[A-Za-zＡ-Ｚａ-ｚ]+)*", "", meaning or "")
    text = re.sub(r"[A-Za-zＡ-Ｚａ-ｚ]{1,2}(?![一-鿿぀-ヿ])", "", text)
    text = _KANA_RE.sub("", text)
    text = re.sub(r"[（(\[]\s*(?:英|美)\s*[）)\]]", "", text)
    text = re.sub(r"[（(]\s*[）)]", "", text)
    text = re.sub(r"\s*([；;，,])\s*", r"\1", text)
    text = re.sub(r"^[\s；;，,、.:：/]+", "", text)
    return text.strip()


def has_kanji(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def kanji_variants() -> dict[str, str]:
    global KANJI_VARIANTS_CACHE
    if KANJI_VARIANTS_CACHE is None:
        if not KANJI_VARIANTS_PATH.exists():
            KANJI_VARIANTS_CACHE = {}
        else:
            payload = json.loads(KANJI_VARIANTS_PATH.read_text(encoding="utf-8"))
            KANJI_VARIANTS_CACHE = payload.get("japanese_to_simplified", {})
    return KANJI_VARIANTS_CACHE


def clean_text(text: str) -> str:
    return text.replace("<br>", "；").strip()


def primary_meaning(meaning: str) -> str:
    for separator in ("；", ";", "，"):
        if separator in meaning:
            return meaning.split(separator, 1)[0].strip()
    return meaning.strip()


SHORT_MEANING_OVERRIDES = {
    596: "敬称",
    750: "职业者",
    847: "对象地点",
    952: "天妇罗",
    1519: "店铺人员",
    1528: "收信地址",
    2008: "种类数",
    2084: "干炸食品",
    2138: "操作",
    2280: "事情件数",
    2303: "法国",
    2340: "卡丁车",
    2358: "体育中心",
    2379: "儿童节",
    2392: "聚会",
    2398: "广岛",
    2401: "维生素剂",
    2425: "高级公寓",
    2428: "邮箱地址",
    2446: "昵称后缀",
    2464: "不久",
    2480: "大楼",
    2494: "路上小心",
    2495: "请多关照",
    2519: "打工",
    2524: "各种各样",
    2525: "神户",
    2539: "威士忌",
    2579: "根据",
    2582: "君称",
    2624: "各种各样",
}

KANJI_MEANING_OVERRIDES = {
    "講座": "讲座",
    "緑茶": "绿茶",
    "色鉛筆": "彩色铅笔",
    "富士山": "富士山",
    "地味": "朴素",
    "派手": "花哨",
    "初詣": "新年参拜",
}


def prompt_meaning(meaning: str, word_id: int | None = None, kanji: str = "") -> str:
    if word_id in SHORT_MEANING_OVERRIDES:
        return SHORT_MEANING_OVERRIDES[word_id]
    if kanji in KANJI_MEANING_OVERRIDES:
        return KANJI_MEANING_OVERRIDES[kanji]
    text = meaning.strip()
    if not text:
        return ""
    parts = []
    current = []
    for char in text:
        if char in "；;，,":
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            if len(parts) >= 3:
                break
            continue
        current.append(char)
    if len(parts) < 3:
        part = "".join(current).strip()
        if part:
            parts.append(part)
    if not parts:
        parts = [text]
    short = parts[0].strip()
    short = re.sub(r"^[⓪①②③④⑤⑥⑦⑧⑨⑩]+", "", short).strip()
    previous = None
    while previous != short:
        previous = short
        short = re.sub(r"^[（(][^）)]{1,40}[）)]", "", short).strip()
    # Remove English glosses such as "shirt", but keep short letter+CJK terms like T恤 or A型.
    short = re.sub(r"^[A-Za-zＡ-Ｚａ-ｚ]{3,}(?:[ .／/'-]+[A-Za-zＡ-Ｚａ-ｚ]+)*", "", short).strip()
    short = re.sub(r"^[A-Za-zＡ-Ｚａ-ｚ]{1,2}(?![一-鿿぀-ヿ])", "", short).strip()
    short = re.sub(r"^[〈《][^〉》]{1,20}[〉》]", "", short).strip()
    if "。" in short:
        short = short.split("。", 1)[0].strip()
    if kanji and len(kanji) <= 5 and not re.search(r"[ぁ-ゟァ-ヿA-Za-z〜～]", kanji):
        prefix = []
        for text_char, kanji_char in zip(short, kanji):
            if text_char != kanji_char:
                break
            prefix.append(text_char)
        if len(prefix) >= 2:
            short = "".join(prefix)
    return short[:8]


def honorific_label(meaning: str) -> str:
    """Tag words that are themselves honorific or humble expressions."""
    text = meaning or ""
    if re.search(r"(謙譲語|謙讓語|谦让语|谦让|謙讓)", text):
        return "谦语"
    if re.search(r"(谦称|謙称|謙稱)", text):
        return "谦称"
    if "自谦" in text:
        return "自谦"
    if re.search(r"(敬语|敬語|尊敬表达|尊敬語|敬称|敬意|对外敬语)", text):
        return "敬语"
    return ""


def correct_noun_suru_words(conn: sqlite3.Connection) -> None:
    conn.executemany(
        """
        UPDATE words
        SET pos = '名词・する动词',
            verb_type = 'suru'
        WHERE kanji = ?
          AND kana = ?
          AND pos = '动词'
          AND verb_type = 'godan'
        """,
        sorted(NOUN_SURU_CORRECTIONS),
    )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                meaning TEXT NOT NULL,
                kana TEXT NOT NULL,
                kanji TEXT NOT NULL,
                pos TEXT NOT NULL,
                verb_type TEXT
            );

            CREATE TABLE IF NOT EXISTS progress (
                word_id INTEGER PRIMARY KEY,
                score INTEGER NOT NULL DEFAULT 0,
                seen_count INTEGER NOT NULL DEFAULT 0,
                low_history INTEGER NOT NULL DEFAULT 0,
                known_forever INTEGER NOT NULL DEFAULT 0,
                mastered_on TEXT,
                last_seen_on TEXT,
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_id INTEGER NOT NULL,
                answer TEXT NOT NULL,
                score_after INTEGER NOT NULL,
                reviewed_on TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stage2_progress (
                reviewed_on TEXT NOT NULL,
                word_id INTEGER NOT NULL,
                order_index INTEGER NOT NULL,
                temp_score REAL NOT NULL DEFAULT 0,
                seen_count INTEGER NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                due_after INTEGER,
                PRIMARY KEY (reviewed_on, word_id),
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS kanji_progress (
                reviewed_on TEXT NOT NULL,
                word_id INTEGER NOT NULL,
                order_index INTEGER NOT NULL,
                temp_score REAL NOT NULL DEFAULT 0,
                seen_count INTEGER NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                due_after INTEGER,
                PRIMARY KEY (reviewed_on, word_id),
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS kanji_memory (
                word_id INTEGER PRIMARY KEY,
                score REAL NOT NULL DEFAULT 0,
                seen_count INTEGER NOT NULL DEFAULT 0,
                right_count INTEGER NOT NULL DEFAULT 0,
                fuzzy_count INTEGER NOT NULL DEFAULT 0,
                forgot_count INTEGER NOT NULL DEFAULT 0,
                low_history INTEGER NOT NULL DEFAULT 0,
                last_seen_on TEXT,
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS kanji_char_overrides (
                char TEXT PRIMARY KEY,
                marked INTEGER NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS word_notes (
                word_id INTEGER PRIMARY KEY,
                note TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS checkins (
                checked_on TEXT PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS word_study_time (
                studied_on TEXT PRIMARY KEY,
                seconds INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS word_auto_known (
                word_id INTEGER PRIMARY KEY,
                first_know_streak INTEGER NOT NULL DEFAULT 0,
                last_first_seen_on TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS critical_reviews (
                reviewed_on TEXT NOT NULL,
                word_id INTEGER NOT NULL,
                reset_on TEXT,
                PRIMARY KEY (reviewed_on, word_id),
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS stage1_tasks (
                reviewed_on TEXT NOT NULL,
                word_id INTEGER NOT NULL,
                task_type TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                PRIMARY KEY (reviewed_on, word_id),
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS moji_migrated_reviews (
                word_id INTEGER PRIMARY KEY,
                imported_on TEXT NOT NULL,
                priority REAL NOT NULL DEFAULT 0,
                activated_on TEXT,
                FOREIGN KEY(word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS grammar_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern TEXT NOT NULL UNIQUE,
                meaning TEXT NOT NULL,
                prompt TEXT NOT NULL,
                formation TEXT NOT NULL,
                example_jp TEXT NOT NULL,
                example_meaning TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                confusions TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT 'N5',
                importance INTEGER NOT NULL DEFAULT 3,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS grammar_points_archive (
                archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
                archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                dataset_version TEXT NOT NULL,
                id INTEGER,
                pattern TEXT NOT NULL,
                meaning TEXT NOT NULL,
                prompt TEXT NOT NULL,
                formation TEXT NOT NULL,
                example_jp TEXT NOT NULL,
                example_meaning TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                confusions TEXT NOT NULL DEFAULT '',
                level TEXT NOT NULL DEFAULT 'N5',
                importance INTEGER NOT NULL DEFAULT 3,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS grammar_progress (
                grammar_id INTEGER PRIMARY KEY,
                score REAL NOT NULL DEFAULT 0,
                seen_count INTEGER NOT NULL DEFAULT 0,
                low_history INTEGER NOT NULL DEFAULT 0,
                known_forever INTEGER NOT NULL DEFAULT 0,
                mastered_on TEXT,
                last_seen_on TEXT,
                right_count INTEGER NOT NULL DEFAULT 0,
                fuzzy_count INTEGER NOT NULL DEFAULT 0,
                forgot_count INTEGER NOT NULL DEFAULT 0,
                mistake_streak INTEGER NOT NULL DEFAULT 0,
                last_decay_amount INTEGER NOT NULL DEFAULT 10,
                FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
            );

            CREATE TABLE IF NOT EXISTS grammar_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grammar_id INTEGER NOT NULL,
                answer TEXT NOT NULL,
                score_after REAL NOT NULL,
                reviewed_on TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
            );

            CREATE TABLE IF NOT EXISTS grammar_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_reviews_day_word
                ON reviews(reviewed_on, word_id);
            CREATE INDEX IF NOT EXISTS idx_reviews_word_day
                ON reviews(word_id, reviewed_on);
            CREATE INDEX IF NOT EXISTS idx_progress_review_pool
                ON progress(known_forever, seen_count, score, mastered_on);
            CREATE INDEX IF NOT EXISTS idx_stage2_day_completed
                ON stage2_progress(reviewed_on, completed, due_after, order_index);
            CREATE INDEX IF NOT EXISTS idx_kanji_day_completed
                ON kanji_progress(reviewed_on, completed, due_after, order_index);
            CREATE INDEX IF NOT EXISTS idx_critical_reset
                ON critical_reviews(reset_on, reviewed_on, word_id);
            CREATE INDEX IF NOT EXISTS idx_stage1_tasks_day_type
                ON stage1_tasks(reviewed_on, task_type, order_index);
            CREATE INDEX IF NOT EXISTS idx_moji_migrated_reviews_activation
                ON moji_migrated_reviews(activated_on, priority);
            CREATE INDEX IF NOT EXISTS idx_grammar_progress_pool
                ON grammar_progress(known_forever, seen_count, score, mastered_on);
            CREATE INDEX IF NOT EXISTS idx_grammar_reviews_day_item
                ON grammar_reviews(reviewed_on, grammar_id);
            """
        )
        ensure_column(conn, "words", "importance", "INTEGER NOT NULL DEFAULT 3")
        ensure_column(conn, "words", "example_jp", "TEXT")
        ensure_column(conn, "words", "example_meaning", "TEXT")
        ensure_column(conn, "progress", "right_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "progress", "fuzzy_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "progress", "forgot_count", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "progress", "mistake_streak", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "progress", "last_decay_amount", "INTEGER NOT NULL DEFAULT 10")
        ensure_column(conn, "words", "shuffle_rank", "REAL")
        ensure_column(conn, "critical_reviews", "reset_on", "TEXT")
        count = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT INTO words (meaning, kana, kanji, pos, verb_type, importance) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        word["meaning"],
                        word["kana"],
                        word["kanji"],
                        word["pos"],
                        word.get("verb_type"),
                        estimate_importance(word),
                    )
                    for word in WORDS[:200]
                ],
            )
        else:
            rows = conn.execute("SELECT * FROM words WHERE importance = 3").fetchall()
            for row in rows:
                conn.execute(
                    "UPDATE words SET importance = ? WHERE id = ?",
                    (estimate_importance(row), row["id"]),
                )
        conn.execute(
            """
            INSERT OR IGNORE INTO progress (word_id)
            SELECT id FROM words
            """
        )
        conn.execute("UPDATE words SET shuffle_rank = ABS(RANDOM()) / 9223372036854775807.0 WHERE shuffle_rank IS NULL")
        conn.execute("UPDATE progress SET score = 0 WHERE seen_count = 0 AND score < 0")
        correct_noun_suru_words(conn)
        seed_grammar_points(conn)
        if not get_state(conn, "first_study_day", ""):
            set_state(conn, "first_study_day", TODAY())
        backfill_examples(conn)
        backfill_stage2_from_reviews(conn)
        apply_daily_decay(conn)


def get_state(conn: sqlite3.Connection, key: str, default: str) -> str:
    row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def delete_state(conn: sqlite3.Connection, key: str) -> None:
    conn.execute("DELETE FROM app_state WHERE key = ?", (key,))


def auto_known_enabled(conn: sqlite3.Connection) -> bool:
    return get_state(conn, "auto_known_enabled", "1") != "0"


def settings_payload(conn: sqlite3.Connection) -> dict:
    return {"autoKnownEnabled": auto_known_enabled(conn)}


def auto_known_row(conn: sqlite3.Connection, word_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM word_auto_known WHERE word_id = ?",
        (word_id,),
    ).fetchone()


def restore_auto_known_row(conn: sqlite3.Connection, snapshot: dict) -> None:
    row = snapshot.get("auto_known_row")
    word_id = snapshot.get("word_id")
    if not word_id:
        return
    if row is None:
        conn.execute("DELETE FROM word_auto_known WHERE word_id = ?", (word_id,))
        return
    conn.execute(
        """
        INSERT INTO word_auto_known (
            word_id, first_know_streak, last_first_seen_on, updated_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(word_id) DO UPDATE SET
            first_know_streak = excluded.first_know_streak,
            last_first_seen_on = excluded.last_first_seen_on,
            updated_at = excluded.updated_at
        """,
        (
            word_id,
            row["first_know_streak"],
            row["last_first_seen_on"],
            row["updated_at"],
        ),
    )


def update_first_seen_streak(
    conn: sqlite3.Connection,
    word_id: int,
    today: str,
    answer: str,
    *,
    enabled: bool,
    already_known: bool,
) -> dict | None:
    row = auto_known_row(conn, word_id)
    current_streak = int(row["first_know_streak"]) if row else 0
    new_streak = current_streak + 1 if answer == "know" else 0
    conn.execute(
        """
        INSERT INTO word_auto_known (word_id, first_know_streak, last_first_seen_on, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(word_id) DO UPDATE SET
            first_know_streak = excluded.first_know_streak,
            last_first_seen_on = excluded.last_first_seen_on,
            updated_at = excluded.updated_at
        """,
        (word_id, new_streak, today),
    )
    if enabled and answer == "know" and new_streak >= 3 and not already_known:
        return {"wordId": word_id, "streak": new_streak}
    return None


def set_current_card(conn: sqlite3.Connection, card: dict | None) -> None:
    """Remember which word was just served so /api/answer can reject stale or
    duplicate submissions (e.g. rapid double-clicks / key-repeat on the answer
    buttons, which used to inflate a word's score and re-loop the last words)."""
    if card and card.get("id") is not None:
        set_state(conn, "current_card", str(card["id"]))
    else:
        # Nothing being served (settlement / between phases): lock so a late
        # duplicate submit for the previous word is ignored rather than replayed.
        set_state(conn, "current_card", "0")


def claim_current_card(conn: sqlite3.Connection, word_id: int) -> bool:
    """Atomically claim the served card. Returns True if `word_id` is the card we
    are currently waiting on (and consumes it so it can only be answered once);
    returns False for a stale or duplicate submit. An empty value means nothing
    has been served yet (fresh state) -> allow for backwards compatibility.

    The consume is a single UPDATE so it is race-safe under ThreadingHTTPServer:
    SQLite serializes the writes, so only the first of two concurrent identical
    submits matches `value = word_id` and wins."""
    expected = get_state(conn, "current_card", "")
    if expected == "":
        return True
    cursor = conn.execute(
        "UPDATE app_state SET value = '0' WHERE key = 'current_card' AND value = ?",
        (str(word_id),),
    )
    return cursor.rowcount > 0


def seed_grammar_points(conn: sqlite3.Connection) -> None:
    current_version = get_grammar_state(conn, "dataset_version", "")
    if current_version != GRAMMAR_DATASET_VERSION:
        existing_count = conn.execute("SELECT COUNT(*) FROM grammar_points").fetchone()[0]
        if existing_count:
            conn.execute(
                """
                INSERT INTO grammar_points_archive (
                    dataset_version, id, pattern, meaning, prompt, formation,
                    example_jp, example_meaning, notes, confusions, level,
                    importance, sort_order
                )
                SELECT ?, id, pattern, meaning, prompt, formation, example_jp,
                    example_meaning, notes, confusions, level, importance, sort_order
                FROM grammar_points
                """,
                (current_version or "legacy-before-pdf-n4",),
            )
        conn.execute("DELETE FROM grammar_reviews")
        conn.execute("DELETE FROM grammar_progress")
        conn.execute("DELETE FROM grammar_points")
        set_grammar_state(conn, "queue", "[]")
        set_grammar_state(conn, "dataset_version", GRAMMAR_DATASET_VERSION)

    for index, item in enumerate(GRAMMAR_POINTS, start=1):
        conn.execute(
            """
            INSERT INTO grammar_points (
                pattern, meaning, prompt, formation, example_jp,
                example_meaning, notes, confusions, level, importance, sort_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pattern) DO UPDATE SET
                meaning = excluded.meaning,
                prompt = excluded.prompt,
                formation = excluded.formation,
                example_jp = excluded.example_jp,
                example_meaning = excluded.example_meaning,
                notes = excluded.notes,
                confusions = excluded.confusions,
                level = excluded.level,
                importance = excluded.importance,
                sort_order = excluded.sort_order
            """,
            (
                item["pattern"],
                item["meaning"],
                item["prompt"],
                item["formation"],
                item["example_jp"],
                item["example_meaning"],
                item.get("notes", ""),
                item.get("confusions", ""),
                item.get("level", "N5"),
                item.get("importance", 3),
                index,
            ),
        )
    conn.execute(
        """
        INSERT OR IGNORE INTO grammar_progress (grammar_id)
        SELECT id FROM grammar_points
        """
    )


def get_grammar_state(conn: sqlite3.Connection, key: str, default: str) -> str:
    row = conn.execute("SELECT value FROM grammar_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_grammar_state(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO grammar_state (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def get_grammar_queue(conn: sqlite3.Connection) -> list[dict]:
    value = get_grammar_state(conn, "queue", "[]")
    try:
        queue = json.loads(value)
    except json.JSONDecodeError:
        return []
    return queue if isinstance(queue, list) else []


def set_grammar_queue(conn: sqlite3.Connection, queue: list[dict]) -> None:
    set_grammar_state(conn, "queue", json.dumps(queue, ensure_ascii=False))


def advance_grammar_queue(conn: sqlite3.Connection, grammar_id: int) -> None:
    queue = []
    for item in get_grammar_queue(conn):
        if item.get("grammar_id") == grammar_id:
            continue
        queue.append(
            {
                "grammar_id": item.get("grammar_id"),
                "due_after": max(int(item.get("due_after", 0)) - 1, 0),
            }
        )
    set_grammar_queue(conn, queue)


def schedule_grammar_review(conn: sqlite3.Connection, grammar_id: int) -> None:
    queue = [item for item in get_grammar_queue(conn) if item.get("grammar_id") != grammar_id]
    queue.append({"grammar_id": grammar_id, "due_after": random.randint(4, 8)})
    set_grammar_queue(conn, queue)


def grammar_mistake_score(row: sqlite3.Row) -> float:
    wrongish = row["forgot_count"] * 2 + row["fuzzy_count"]
    total = wrongish + row["right_count"]
    if total == 0:
        return 0.0
    return min(wrongish / total + min(row["mistake_streak"] * 0.08, 0.32), 1.0)


def grammar_decay_tenths(row: sqlite3.Row) -> int:
    decay = 10 + row["importance"] - 3 + round(grammar_mistake_score(row) * 2)
    if row["right_count"] >= row["forgot_count"] + row["fuzzy_count"] + 3:
        decay -= 1
    return min(max(decay, 8), 12)


def apply_grammar_daily_decay(conn: sqlite3.Connection) -> None:
    today = TODAY()
    last_decay = get_grammar_state(conn, "last_decay", "")
    if not last_decay:
        set_grammar_state(conn, "last_decay", today)
        return
    if last_decay == today:
        return
    rows = conn.execute(
        """
        SELECT g.importance, p.*
        FROM grammar_progress p
        JOIN grammar_points g ON g.id = p.grammar_id
        WHERE p.known_forever = 0 AND p.seen_count > 0
        """
    ).fetchall()
    for row in rows:
        decay = grammar_decay_tenths(row)
        conn.execute(
            """
            UPDATE grammar_progress
            SET score = MAX(score - ?, -40),
                mastered_on = NULL,
                last_decay_amount = ?
            WHERE grammar_id = ?
            """,
            (decay / 10, decay, row["grammar_id"]),
        )
    set_grammar_state(conn, "last_decay", today)


def grammar_card(row: sqlite3.Row) -> dict:
    question = grammar_question_prompt(row["meaning"])
    return {
        "id": row["id"],
        "pattern": question,
        "meaning": row["meaning"],
        # prompt 与题目一致,前端不会再额外显示一行泄露假名语法形。
        "prompt": question,
        "formation": row["formation"],
        "example": {
            "jp": furigana(row["example_jp"]),
            "meaning": row["example_meaning"],
        },
        "notes": row["notes"],
        "confusions": [item.strip() for item in row["confusions"].split("；") if item.strip()],
        "level": row["level"],
        "score": round(row["score"], 1),
        "importance": row["importance"],
    }


def grammar_card_by_id(conn: sqlite3.Connection, grammar_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT g.*, p.score
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE g.id = ?
        """,
        (grammar_id,),
    ).fetchone()
    return grammar_card(row) if row else None


def grammar_level_clause(level: str | None) -> tuple[str, tuple[str, ...]]:
    if not level or level == "All":
        return "", ()
    return " AND g.level = ? ", (level,)


def pick_grammar_next(conn: sqlite3.Connection, level: str | None = None) -> dict | None:
    today = TODAY()
    level_clause, level_params = grammar_level_clause(level)
    due_ids = [
        int(item.get("grammar_id", 0))
        for item in get_grammar_queue(conn)
        if int(item.get("due_after", 0)) <= 0
    ]
    if due_ids:
        placeholders = ",".join("?" for _ in due_ids)
        row = conn.execute(
            f"""
            SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
                   p.right_count, p.mistake_streak
            FROM grammar_points g
            JOIN grammar_progress p ON p.grammar_id = g.id
            WHERE g.id IN ({placeholders})
              AND p.known_forever = 0
              AND (p.mastered_on IS NULL OR p.mastered_on != ?)
              {level_clause}
            ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC
            LIMIT 1
            """,
            (*due_ids, today, *level_params),
        ).fetchone()
        if row:
            return grammar_card(row)

    critical = conn.execute(
        f"""
        SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
               p.right_count, p.mistake_streak
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE p.known_forever = 0
          AND p.seen_count > 0
          AND p.score <= ?
          AND (p.mastered_on IS NULL OR p.mastered_on != ?)
          {level_clause}
        ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, g.importance DESC
        LIMIT 1
        """,
        (CRITICAL_SCORE, today, *level_params),
    ).fetchone()
    if critical:
        return grammar_card(critical)

    low = conn.execute(
        f"""
        SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
               p.right_count, p.mistake_streak
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE p.known_forever = 0
          AND p.seen_count > 0
          AND p.score <= 6
          AND (p.mastered_on IS NULL OR p.mastered_on != ?)
          {level_clause}
        ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, g.importance DESC
        LIMIT 1
        """,
        (today, *level_params),
    ).fetchone()
    if low:
        return grammar_card(low)

    unseen = conn.execute(
        f"""
        SELECT g.*, p.score, p.seen_count, p.forgot_count, p.fuzzy_count,
               p.right_count, p.mistake_streak
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE p.known_forever = 0
          AND p.seen_count = 0
          {level_clause}
        ORDER BY CASE g.level
            WHEN 'N5' THEN 1
            WHEN 'N4' THEN 2
            WHEN 'N3' THEN 3
            WHEN 'N2' THEN 4
            WHEN 'N1' THEN 5
            ELSE 9
        END, g.sort_order ASC
        LIMIT 1
        """,
        level_params,
    ).fetchone()
    if unseen:
        return grammar_card(unseen)
    return None


def pick_grammar_random(conn: sqlite3.Connection, level: str | None = None) -> dict | None:
    """考题阶段:纯随机抽题(按等级过滤),不走 SRS 推词算法。"""
    level_clause, level_params = grammar_level_clause(level)
    row = conn.execute(
        f"""
        SELECT g.*, p.score
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE p.known_forever = 0
          {level_clause}
        ORDER BY RANDOM()
        LIMIT 1
        """,
        level_params,
    ).fetchone()
    return grammar_card(row) if row else None


def grammar_review_list(conn: sqlite3.Connection, level: str | None = None, limit: int = 300) -> list[dict]:
    """复习板块:按不熟悉程度(分数升序)排列语法点。"""
    level_clause, level_params = grammar_level_clause(level)
    rows = conn.execute(
        f"""
        SELECT g.id, g.pattern, g.prompt, g.meaning, g.level, g.formation, g.importance,
               p.score, p.seen_count, p.forgot_count, p.fuzzy_count, p.right_count
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE p.known_forever = 0
          {level_clause}
        ORDER BY p.score ASC, p.forgot_count DESC, p.fuzzy_count DESC, g.importance DESC
        LIMIT ?
        """,
        (*level_params, limit),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "pattern": furigana(clean_grammar_title(r["pattern"], r["prompt"])),
            "meaning": r["meaning"],
            "level": r["level"],
            "formation": r["formation"],
            "score": round(r["score"], 1),
            "seen": r["seen_count"],
            "forgot": r["forgot_count"],
            "fuzzy": r["fuzzy_count"],
            "right": r["right_count"],
        }
        for r in rows
    ]


def grammar_stats(conn: sqlite3.Connection, level: str | None = None) -> dict:
    today = TODAY()
    level_clause, level_params = grammar_level_clause(level)
    row = conn.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN p.known_forever = 1 THEN 1 ELSE 0 END) AS known_forever,
            SUM(CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END) AS unseen,
            SUM(CASE WHEN p.seen_count > 0 AND p.known_forever = 0 AND p.score <= 6 THEN 1 ELSE 0 END) AS low_count,
            SUM(CASE WHEN p.mastered_on = ? THEN 1 ELSE 0 END) AS mastered_today
        FROM grammar_points g
        JOIN grammar_progress p ON p.grammar_id = g.id
        WHERE 1 = 1
        {level_clause}
        """,
        (today, *level_params),
    ).fetchone()
    reviewed_today = conn.execute(
        f"""
        SELECT COUNT(DISTINCT r.grammar_id)
        FROM grammar_reviews r
        JOIN grammar_points g ON g.id = r.grammar_id
        WHERE r.reviewed_on = ?
        {level_clause}
        """,
        (today, *level_params),
    ).fetchone()[0]
    total = row["total"] or 0
    done = (row["known_forever"] or 0) + (total - (row["unseen"] or 0) - (row["low_count"] or 0))
    return {
        "total": total,
        "knownForever": row["known_forever"] or 0,
        "unseenCount": row["unseen"] or 0,
        "lowCount": row["low_count"] or 0,
        "masteredToday": row["mastered_today"] or 0,
        "reviewedToday": reviewed_today,
        "progressDone": min(max(done, 0), max(total, 1)),
        "progressTotal": total,
        "studyDate": today,
    }


def answer_grammar(conn: sqlite3.Connection, grammar_id: int, answer: str, level: str | None = None) -> dict:
    today = TODAY()
    progress = conn.execute(
        "SELECT * FROM grammar_progress WHERE grammar_id = ?",
        (grammar_id,),
    ).fetchone()
    if not progress:
        raise ValueError("Grammar point not found")
    advance_grammar_queue(conn, grammar_id)
    score = progress["score"]
    known_forever = progress["known_forever"]
    if answer == "known_forever":
        known_forever = 1
        right_count = progress["right_count"]
        fuzzy_count = progress["fuzzy_count"]
        forgot_count = progress["forgot_count"]
        mistake_streak = 0
    else:
        delta = {"forgot": -10, "fuzzy": -5, "know": 10}[answer]
        score = max(score + delta, -40)
        right_count = progress["right_count"] + (1 if answer == "know" else 0)
        fuzzy_count = progress["fuzzy_count"] + (1 if answer == "fuzzy" else 0)
        forgot_count = progress["forgot_count"] + (1 if answer == "forgot" else 0)
        mistake_streak = 0 if answer == "know" else progress["mistake_streak"] + 1
    low_history = progress["low_history"] or 0
    if score <= CRITICAL_SCORE:
        low_history = 1
    mastered_on = today if score >= 10 and not known_forever else None
    if score <= 6 and not known_forever:
        schedule_grammar_review(conn, grammar_id)
    conn.execute(
        """
        UPDATE grammar_progress
        SET score = ?, seen_count = seen_count + 1, low_history = ?,
            known_forever = ?, mastered_on = ?, last_seen_on = ?,
            right_count = ?, fuzzy_count = ?, forgot_count = ?,
            mistake_streak = ?
        WHERE grammar_id = ?
        """,
        (
            score,
            low_history,
            known_forever,
            mastered_on,
            today,
            right_count,
            fuzzy_count,
            forgot_count,
            mistake_streak,
            grammar_id,
        ),
    )
    conn.execute(
        """
        INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on)
        VALUES (?, ?, ?, ?)
        """,
        (grammar_id, answer, score, today),
    )
    return {"card": pick_grammar_next(conn, level), "stats": grammar_stats(conn, level)}


def backfill_examples(conn: sqlite3.Connection) -> None:
    source = BASE_DIR / "data" / "eggrolls_notes.csv"
    if not source.exists():
        return
    examples = {}
    with source.open(encoding="utf-8") as file:
        for row in csv.reader(file, delimiter="\t"):
            if not row or row[0].startswith("#") or len(row) < 15:
                continue
            written, reading = row[3].strip(), row[6].strip()
            if not written or not reading:
                continue
            if has_ascii(reading) and has_katakana(written):
                kana, kanji = written, reading
            else:
                kana, kanji = reading, written or reading
            example_jp = clean_text(row[12]) if len(row) > 12 else ""
            example_meaning = clean_text(row[14]) if len(row) > 14 else ""
            if example_jp and example_meaning:
                examples[(kanji, kana)] = (example_jp, example_meaning)
    for (kanji, kana), (example_jp, example_meaning) in examples.items():
        conn.execute(
            """
            UPDATE words
            SET example_jp = COALESCE(example_jp, ?),
                example_meaning = COALESCE(example_meaning, ?)
            WHERE kanji = ?
              AND kana = ?
              AND (example_jp IS NULL OR example_meaning IS NULL)
            """,
            (example_jp, example_meaning, kanji, kana),
        )


def get_review_queue(conn: sqlite3.Connection) -> list[dict]:
    value = get_state(conn, "review_queue", "[]")
    try:
        queue = json.loads(value)
    except json.JSONDecodeError:
        return []
    return queue if isinstance(queue, list) else []


def set_review_queue(conn: sqlite3.Connection, queue: list[dict]) -> None:
    set_state(conn, "review_queue", json.dumps(queue, ensure_ascii=False))


def advance_review_queue(conn: sqlite3.Connection, answered_word_id: int) -> None:
    queue = []
    for item in get_review_queue(conn):
        if item.get("word_id") == answered_word_id:
            continue
        queue.append(
            {
                "word_id": item.get("word_id"),
                "due_after": max(int(item.get("due_after", 0)) - 1, 0),
            }
        )
    set_review_queue(conn, queue)


def schedule_delayed_review(conn: sqlite3.Connection, word_id: int) -> None:
    queue = [item for item in get_review_queue(conn) if item.get("word_id") != word_id]
    queue.append({"word_id": word_id, "due_after": random.randint(4, 8)})
    set_review_queue(conn, queue)


def current_phase(conn: sqlite3.Connection) -> str:
    today = TODAY()
    if get_state(conn, "phase_date", "") != today:
        set_state(conn, "phase_date", today)
        set_state(conn, "phase", "stage1")
    phase = get_state(conn, "phase", "stage1")
    if phase == "stage2":
        stage2 = stage2_stats(conn)
        if stage2["total"] > 0 and stage2["completed"] >= stage2["total"]:
            set_state(conn, "phase", "done")
            return "done"
    if phase == "kanji":
        kanji = kanji_stats(conn)
        if kanji["total"] > 0 and kanji["completed"] >= kanji["total"]:
            set_state(conn, "phase", "checkin")
            return "checkin"
    return phase


def set_phase(conn: sqlite3.Connection, phase: str) -> None:
    set_state(conn, "phase_date", TODAY())
    set_state(conn, "phase", phase)


def record_checkin(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",
        (TODAY(),),
    )


def checkin_days(conn: sqlite3.Connection) -> list[str]:
    return [
        row["checked_on"]
        for row in conn.execute(
            """
            SELECT checked_on
            FROM checkins
            WHERE checked_on BETWEEN '2026-06-01' AND '2027-06-30'
            ORDER BY checked_on
            """
        ).fetchall()
    ]


def add_word_study_seconds(conn: sqlite3.Connection, seconds: int) -> int:
    seconds = max(0, min(int(seconds), 300))
    today = TODAY()
    if seconds:
        conn.execute(
            """
            INSERT INTO word_study_time (studied_on, seconds, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(studied_on) DO UPDATE SET
                seconds = word_study_time.seconds + excluded.seconds,
                updated_at = excluded.updated_at
            """,
            (today, seconds),
        )
    return word_study_seconds(conn, today)


def word_study_seconds(conn: sqlite3.Connection, studied_on: str | None = None) -> int:
    row = conn.execute(
        "SELECT seconds FROM word_study_time WHERE studied_on = ?",
        (studied_on or TODAY(),),
    ).fetchone()
    return int(row["seconds"] or 0) if row else 0


def daily_study_stats(conn: sqlite3.Connection) -> list[dict]:
    days: dict[str, dict[str, int | str]] = {}
    for row in conn.execute(
        """
        SELECT studied_on, seconds
        FROM word_study_time
        WHERE studied_on BETWEEN '2026-06-01' AND '2027-06-30'
        """
    ).fetchall():
        day = row["studied_on"]
        days.setdefault(day, {"date": day, "seconds": 0, "wordCount": 0})
        days[day]["seconds"] = int(row["seconds"] or 0)
    for row in conn.execute(
        """
        SELECT reviewed_on, COUNT(DISTINCT word_id) AS word_count
        FROM reviews
        WHERE reviewed_on BETWEEN '2026-06-01' AND '2027-06-30'
        GROUP BY reviewed_on
        """
    ).fetchall():
        day = row["reviewed_on"]
        days.setdefault(day, {"date": day, "seconds": 0, "wordCount": 0})
        days[day]["wordCount"] = int(row["word_count"] or 0)
    for day in checkin_days(conn):
        days.setdefault(day, {"date": day, "seconds": 0, "wordCount": 0})
    return [days[day] for day in sorted(days)]


def record_critical_review(conn: sqlite3.Connection, word_id: int) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id) VALUES (?, ?)",
        (TODAY(), word_id),
    )


def backfill_critical_reviews(conn: sqlite3.Connection, before_day: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO critical_reviews (reviewed_on, word_id)
        SELECT reviewed_on, word_id
        FROM reviews
        WHERE reviewed_on < ?
          AND score_after <= ?
        """,
        (before_day, CRITICAL_SCORE),
    )


def reset_previous_critical_reviews(conn: sqlite3.Connection, today: str) -> None:
    conn.execute(
        """
        UPDATE progress
        SET score = -1,
            mastered_on = NULL,
            low_history = 1
        WHERE known_forever = 0
          AND word_id IN (
              SELECT word_id
              FROM critical_reviews
              WHERE reviewed_on < ?
                AND reset_on IS NULL
          )
        """,
        (today,),
    )
    conn.execute(
        """
        UPDATE critical_reviews
        SET reset_on = ?
        WHERE reviewed_on < ?
          AND reset_on IS NULL
        """,
        (today, today),
    )


def record_stage2_word(conn: sqlite3.Connection, word_id: int) -> None:
    today = TODAY()
    exists = conn.execute(
        "SELECT 1 FROM stage2_progress WHERE reviewed_on = ? AND word_id = ?",
        (today, word_id),
    ).fetchone()
    if exists:
        return
    order_index = conn.execute(
        "SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage2_progress WHERE reviewed_on = ?",
        (today,),
    ).fetchone()[0]
    conn.execute(
        """
        INSERT INTO stage2_progress (reviewed_on, word_id, order_index)
        VALUES (?, ?, ?)
        """,
        (today, word_id, order_index),
    )


def backfill_stage2_from_reviews(conn: sqlite3.Connection) -> None:
    today = TODAY()
    rows = conn.execute(
        """
        SELECT word_id, MIN(id) AS first_review_id
        FROM reviews
        WHERE reviewed_on = ? AND answer != 'known_forever'
        GROUP BY word_id
        ORDER BY first_review_id ASC
        """,
        (today,),
    ).fetchall()
    for index, row in enumerate(rows, start=1):
        conn.execute(
            """
            INSERT OR IGNORE INTO stage2_progress (reviewed_on, word_id, order_index)
            VALUES (?, ?, ?)
            """,
            (today, row["word_id"], index),
        )
    conn.execute(
        """
        WITH rollup AS (
            SELECT
                word_id,
                COUNT(*) AS seen,
                CASE
                    WHEN SUM(
                        CASE answer
                            WHEN 'forgot' THEN -10
                            WHEN 'fuzzy' THEN -5
                            WHEN 'know' THEN 10
                            ELSE 0
                        END
                    ) < -40 THEN -40
                    ELSE SUM(
                        CASE answer
                            WHEN 'forgot' THEN -10
                            WHEN 'fuzzy' THEN -5
                            WHEN 'know' THEN 10
                            ELSE 0
                        END
                    )
                END AS score
            FROM reviews
            WHERE reviewed_on = ?
              AND answer != 'known_forever'
            GROUP BY word_id
        )
        UPDATE stage2_progress
        SET temp_score = (
                SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
            ),
            seen_count = (
                SELECT seen FROM rollup WHERE rollup.word_id = stage2_progress.word_id
            ),
            completed = CASE
                WHEN (
                    SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
                ) >= 10 THEN 1
                ELSE completed
            END,
            due_after = CASE
                WHEN (
                    SELECT score FROM rollup WHERE rollup.word_id = stage2_progress.word_id
                ) >= 10 THEN NULL
                ELSE due_after
            END
        WHERE reviewed_on = ?
          AND seen_count = 0
          AND word_id IN (SELECT word_id FROM rollup)
        """,
        (today, today),
    )
    conn.execute(
        """
        UPDATE stage2_progress
        SET completed = 1,
            due_after = NULL
        WHERE reviewed_on = ?
          AND word_id IN (
              SELECT word_id
              FROM progress
              WHERE known_forever = 1
          )
        """,
        (today,),
    )


def advance_stage2_queue(conn: sqlite3.Connection, answered_word_id: int) -> None:
    today = TODAY()
    conn.execute(
        """
        UPDATE stage2_progress
        SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
        WHERE reviewed_on = ?
          AND completed = 0
          AND word_id != ?
          AND due_after IS NOT NULL
        """,
        (today, answered_word_id),
    )


def stage2_card_by_id(conn: sqlite3.Connection, word_id: int) -> dict | None:
    today = TODAY()
    row = conn.execute(
        """
        SELECT w.*, s.temp_score AS score
        FROM words w
        JOIN stage2_progress s ON s.word_id = w.id
        WHERE s.reviewed_on = ? AND w.id = ?
        """,
        (today, word_id),
    ).fetchone()
    return row_to_card(row, conn) if row else None


def pick_stage2_next(conn: sqlite3.Connection) -> dict | None:
    today = TODAY()
    rows = conn.execute(
        """
        SELECT w.*, s.temp_score AS score, s.temp_score, s.seen_count, s.due_after, s.order_index
        FROM stage2_progress s
        JOIN words w ON w.id = s.word_id
        WHERE s.reviewed_on = ?
          AND s.completed = 0
        """,
        (today,),
    ).fetchall()
    critical_pool_row = pick_due_critical_pool_row(rows)
    if critical_pool_row:
        return row_to_card(critical_pool_row, conn)
    due_rows = [row for row in rows if row["due_after"] is None or row["due_after"] <= 0]
    if due_rows:
        row = min(due_rows, key=lambda item: (item["temp_score"], item["seen_count"], item["order_index"]))
        return row_to_card(row, conn)
    if not rows:
        return None
    row = min(rows, key=lambda item: (item["due_after"] if item["due_after"] is not None else 0, item["order_index"]))
    return row_to_card(row, conn)


def stage2_stats(conn: sqlite3.Connection) -> dict:
    today = TODAY()
    row = conn.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
        FROM stage2_progress
        WHERE reviewed_on = ?
        """,
        (today,),
    ).fetchone()
    return {"total": row["total"] or 0, "completed": row["completed"] or 0}


def kanji_component_items(conn: sqlite3.Connection, text: str) -> list[dict]:
    overrides = {
        row["char"]: row["marked"]
        for row in conn.execute("SELECT char, marked FROM kanji_char_overrides")
    }
    variants = kanji_variants()
    components = []
    seen = set()
    for char in text:
        if not ("\u4e00" <= char <= "\u9fff") or char in seen:
            continue
        seen.add(char)
        simplified = variants.get(char, char)
        auto_marked = simplified != char
        override = overrides.get(char)
        marked = bool(auto_marked if override is None else override)
        components.append(
            {
                "char": char,
                "simplified": simplified,
                "marked": marked,
                "source": "manual" if override is not None else "auto",
            }
        )
    return components


def kanji_card(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    card = row_to_card(row, conn)
    try:
        card["kanjiPriority"] = round(row["kanji_priority"], 2)
    except (IndexError, KeyError):
        card["kanjiPriority"] = 0
    return card


def date_gap_days(last_seen_on: str | None, today: str) -> int:
    if not last_seen_on:
        return 30
    try:
        return max((date.fromisoformat(today) - date.fromisoformat(last_seen_on)).days, 0)
    except ValueError:
        return 30


def kanji_priority(row: sqlite3.Row, today: str) -> float:
    memory_score = row["memory_score"] if row["memory_score"] is not None else 0
    memory_seen = row["memory_seen_count"] or 0
    forgot = row["kanji_forgot_count"] or 0
    fuzzy = row["kanji_fuzzy_count"] or 0
    right = row["kanji_right_count"] or 0
    low_history = row["kanji_low_history"] or 0
    today_seen = row["today_seen_count"] or 0
    score = 50
    score += max(0, 10 - memory_score) * 4
    score += forgot * 12 + fuzzy * 6
    if low_history:
        score += 25
    score += min(15, date_gap_days(row["kanji_last_seen_on"], today) * 2)
    if memory_seen == 0:
        score += 8
    if right >= forgot + fuzzy + 3 and memory_score >= 10:
        score -= 10
    score -= today_seen * 8
    return round(score, 4)


def build_kanji_progress_from_reviews(conn: sqlite3.Connection) -> None:
    today = TODAY()
    ensure_stage1_tasks(conn)
    rows = conn.execute(
        """
        SELECT
            t.word_id,
            w.kanji,
            t.order_index,
            COALESCE(km.score, 0) AS memory_score,
            COALESCE(km.seen_count, 0) AS memory_seen_count,
            COALESCE(km.right_count, 0) AS kanji_right_count,
            COALESCE(km.fuzzy_count, 0) AS kanji_fuzzy_count,
            COALESCE(km.forgot_count, 0) AS kanji_forgot_count,
            COALESCE(km.low_history, 0) AS kanji_low_history,
            km.last_seen_on AS kanji_last_seen_on,
            COALESCE(kp.seen_count, 0) AS today_seen_count
        FROM stage1_tasks t
        JOIN words w ON w.id = t.word_id
        LEFT JOIN kanji_memory km ON km.word_id = t.word_id
        LEFT JOIN kanji_progress kp ON kp.reviewed_on = t.reviewed_on AND kp.word_id = t.word_id
        WHERE t.reviewed_on = ?
          AND w.kanji != w.kana
        ORDER BY t.order_index ASC
        """,
        (today,),
    ).fetchall()
    candidates = []
    for row in rows:
        if not has_kanji(row["kanji"]):
            continue
        candidates.append((kanji_priority(row, today), row))
    candidates.sort(key=lambda item: (item[0], -item[1]["order_index"]), reverse=True)
    for order_index, (priority, row) in enumerate(candidates, start=1):
        conn.execute(
            """
            INSERT INTO kanji_progress (reviewed_on, word_id, order_index, temp_score, completed)
            VALUES (?, ?, ?, 0, 0)
            ON CONFLICT(reviewed_on, word_id) DO UPDATE SET
                order_index = excluded.order_index
            """,
            (today, row["word_id"], order_index),
        )


def advance_kanji_queue(conn: sqlite3.Connection, answered_word_id: int) -> None:
    today = TODAY()
    conn.execute(
        """
        UPDATE kanji_progress
        SET due_after = MAX(COALESCE(due_after, 0) - 1, 0)
        WHERE reviewed_on = ?
          AND completed = 0
          AND word_id != ?
          AND due_after IS NOT NULL
        """,
        (today, answered_word_id),
    )


def kanji_card_by_id(conn: sqlite3.Connection, word_id: int) -> dict | None:
    today = TODAY()
    row = conn.execute(
        """
        SELECT
            w.*,
            k.temp_score AS score,
            COALESCE(km.score, 0) AS memory_score,
            COALESCE(km.seen_count, 0) AS memory_seen_count,
            COALESCE(km.right_count, 0) AS kanji_right_count,
            COALESCE(km.fuzzy_count, 0) AS kanji_fuzzy_count,
            COALESCE(km.forgot_count, 0) AS kanji_forgot_count,
            COALESCE(km.low_history, 0) AS kanji_low_history,
            km.last_seen_on AS kanji_last_seen_on,
            k.seen_count AS today_seen_count,
            0 AS kanji_priority
        FROM words w
        JOIN kanji_progress k ON k.word_id = w.id
        LEFT JOIN kanji_memory km ON km.word_id = w.id
        WHERE k.reviewed_on = ? AND w.id = ?
        """,
        (today, word_id),
    ).fetchone()
    return kanji_card(row, conn) if row else None


def pick_kanji_next(conn: sqlite3.Connection) -> dict | None:
    today = TODAY()
    rows = conn.execute(
        """
        SELECT
            w.*,
            k.temp_score AS score,
            k.order_index,
            k.due_after,
            k.seen_count AS today_seen_count,
            COALESCE(km.score, 0) AS memory_score,
            COALESCE(km.seen_count, 0) AS memory_seen_count,
            COALESCE(km.right_count, 0) AS kanji_right_count,
            COALESCE(km.fuzzy_count, 0) AS kanji_fuzzy_count,
            COALESCE(km.forgot_count, 0) AS kanji_forgot_count,
            COALESCE(km.low_history, 0) AS kanji_low_history,
            km.last_seen_on AS kanji_last_seen_on
        FROM kanji_progress k
        JOIN words w ON w.id = k.word_id
        LEFT JOIN kanji_memory km ON km.word_id = w.id
        WHERE k.reviewed_on = ?
          AND k.completed = 0
        """,
        (today,),
    ).fetchall()
    critical_pool_row = pick_due_critical_pool_row(rows)
    if critical_pool_row:
        card = kanji_card(critical_pool_row, conn)
        card["kanjiPriority"] = kanji_priority(critical_pool_row, today)
        return card
    due_rows = [row for row in rows if row["due_after"] is None or row["due_after"] <= 0]
    if due_rows:
        row = max(due_rows, key=lambda item: (kanji_priority(item, today), -item["order_index"]))
        card = kanji_card(row, conn)
        card["kanjiPriority"] = kanji_priority(row, today)
        return card
    if not rows:
        return None
    row = min(rows, key=lambda item: (item["due_after"] if item["due_after"] is not None else 0, item["order_index"]))
    card = kanji_card(row, conn)
    card["kanjiPriority"] = kanji_priority(row, today)
    return card


def kanji_stats(conn: sqlite3.Connection) -> dict:
    today = TODAY()
    row = conn.execute(
        """
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
        FROM kanji_progress
        WHERE reviewed_on = ?
        """,
        (today,),
    ).fetchone()
    return {"total": row["total"] or 0, "completed": row["completed"] or 0}


def difficult_words(conn: sqlite3.Connection) -> list[dict]:
    today = TODAY()
    rows = conn.execute(
        """
        SELECT
            w.id,
            w.kana,
            w.kanji,
            w.meaning,
            p.score,
            COUNT(r.id) AS stage1_seen,
            SUM(CASE WHEN r.answer = 'forgot' THEN 1 ELSE 0 END) AS forgot_count,
            SUM(CASE WHEN r.answer = 'fuzzy' THEN 1 ELSE 0 END) AS fuzzy_count,
            MIN(r.score_after) AS min_score,
            COALESCE(s.seen_count, 0) AS stage2_seen,
            COALESCE(s.temp_score, 0) AS stage2_score,
            COALESCE(s.completed, 0) AS stage2_completed,
            t.task_type
        FROM stage1_tasks t
        JOIN words w ON w.id = t.word_id
        JOIN progress p ON p.word_id = t.word_id
        LEFT JOIN reviews r ON r.word_id = t.word_id AND r.reviewed_on = t.reviewed_on
        LEFT JOIN stage2_progress s ON s.word_id = t.word_id AND s.reviewed_on = t.reviewed_on
        WHERE t.reviewed_on = ?
        GROUP BY t.word_id
        """,
        (today,),
    ).fetchall()
    result = []
    for row in rows:
        stage1_seen = row["stage1_seen"] or 0
        forgot = row["forgot_count"] or 0
        fuzzy = row["fuzzy_count"] or 0
        min_score = row["min_score"] if row["min_score"] is not None else row["score"]
        stage2_seen = row["stage2_seen"] or 0
        total_seen = stage1_seen + stage2_seen
        if total_seen <= 1 and forgot == 0 and fuzzy == 0 and min_score > 6:
            continue
        focus_score = total_seen * 10 + forgot * 8 + fuzzy * 4 + max(0, 10 - min_score)
        result.append(
            {
                "id": row["id"],
                "kana": row["kana"],
                "kanji": row["kanji"],
                "meaning": primary_meaning(row["meaning"]),
                "risk": round(focus_score, 1),
                "stage1Seen": stage1_seen,
                "stage2Seen": stage2_seen,
                "todaySeen": total_seen,
                "forgot": forgot,
                "fuzzy": fuzzy,
                "minScore": round(min_score, 1),
                "finalScore": round(row["score"], 1),
                "taskType": row["task_type"],
            }
        )
    result.sort(
        key=lambda item: (
            item["todaySeen"],
            item["forgot"],
            item["fuzzy"],
            -item["minScore"],
            item["risk"],
            -item["finalScore"],
        ),
        reverse=True,
    )
    return result


def mistake_score(row: sqlite3.Row) -> float:
    wrongish = row["forgot_count"] * 2 + row["fuzzy_count"]
    total = wrongish + row["right_count"]
    if total == 0:
        return 0.0
    streak_bonus = min(row["mistake_streak"] * 0.08, 0.32)
    return min(wrongish / total + streak_bonus, 1.0)


def weighted_decay_tenths(row: sqlite3.Row) -> int:
    decay = 10
    decay += row["importance"] - 3
    decay += round(mistake_score(row) * 2)
    if row["right_count"] >= row["forgot_count"] + row["fuzzy_count"] + 3:
        decay -= 1
    return min(max(decay, 8), 12)


def apply_daily_decay(conn: sqlite3.Connection) -> None:
    today = TODAY()
    last_decay = get_state(conn, "last_decay", "")
    if not last_decay:
        set_state(conn, "last_decay", today)
        return
    if last_decay == today:
        return
    rows = conn.execute(
        """
        SELECT w.importance, p.*
        FROM progress p JOIN words w ON w.id = p.word_id
        WHERE p.known_forever = 0 AND p.seen_count > 0
        """
    ).fetchall()
    for row in rows:
        decay = weighted_decay_tenths(row)
        conn.execute(
            """
            UPDATE progress
            SET score = MAX(score - ?, ?),
                mastered_on = NULL,
                last_decay_amount = ?
            WHERE word_id = ?
            """,
            (decay / 10, AUTO_DECAY_FLOOR, decay, row["word_id"]),
        )
    backfill_critical_reviews(conn, today)
    reset_previous_critical_reviews(conn, today)
    set_state(conn, "last_decay", today)


def conjugations(word: sqlite3.Row) -> list[dict[str, str]]:
    verb_type = word["verb_type"]
    if not verb_type:
        return []
    base = word["kanji"] or word["kana"]
    if verb_type == "ichidan":
        stem = base[:-1]
        return [
            {"label": "ます形", "value": stem + "ます"},
            {"label": "ない形", "value": stem + "ない"},
            {"label": "た形", "value": stem + "た"},
            {"label": "て形", "value": stem + "て"},
            {"label": "可能形", "value": stem + "られる"},
        ]
    if verb_type == "suru":
        stem = "" if base == "する" else base
        return [
            {"label": "ます形", "value": stem + "します"},
            {"label": "ない形", "value": stem + "しない"},
            {"label": "た形", "value": stem + "した"},
            {"label": "て形", "value": stem + "して"},
            {"label": "可能形", "value": stem + "できる"},
        ]
    if verb_type == "kuru":
        return [
            {"label": "ます形", "value": "来ます"},
            {"label": "ない形", "value": "来ない"},
            {"label": "た形", "value": "来た"},
            {"label": "て形", "value": "来て"},
            {"label": "可能形", "value": "来られる"},
        ]
    if verb_type == "iku":
        return [
            {"label": "ます形", "value": "行きます"},
            {"label": "ない形", "value": "行かない"},
            {"label": "た形", "value": "行った"},
            {"label": "て形", "value": "行って"},
            {"label": "可能形", "value": "行ける"},
        ]
    if verb_type == "godan":
        ending = base[-1]
        forms = GODAN.get(ending)
        if not forms:
            return []
        masu, nai, ta, te = forms
        stem = base[:-1]
        return [
            {"label": "ます形", "value": stem + masu + "ます"},
            {"label": "ない形", "value": stem + nai + "ない"},
            {"label": "た形", "value": stem + ta},
            {"label": "て形", "value": stem + te},
        ]
    return []


def verb_pair_hint(conn: sqlite3.Connection | None, row: sqlite3.Row) -> dict | None:
    pair_hints = eggrolls_verb_pair_hints()
    kanji = row["kanji"] or ""
    kana = row["kana"] or ""
    key = kanji if kanji in pair_hints else kana if (not kanji or kanji == kana) and kana in pair_hints else ""
    if key not in pair_hints:
        return None
    voice, pair_kanji, pair_kana, note = pair_hints[key]
    pair = None
    if conn:
        pair = conn.execute(
            """
            SELECT kana, kanji, meaning
            FROM words
            WHERE kana = ? OR kanji = ?
            ORDER BY CASE WHEN kanji = ? THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (pair_kana, pair_kanji, pair_kanji),
        ).fetchone()
    return {
        "voice": voice,
        "pairVoice": "自动词" if voice == "他动词" else "他动词",
        "kana": pair["kana"] if pair else pair_kana,
        "kanji": pair["kanji"] if pair else pair_kanji,
        "meaning": pair["meaning"] if pair else "",
        "note": note,
    }


def sense_distinctions(row: sqlite3.Row) -> list[dict[str, str]]:
    keys = {row["kana"], row["kanji"]}
    for group in SENSE_GROUPS:
        if keys & group["keys"]:
            return [
                {"kanji": kanji, "kana": kana, "meaning": note, "kind": "sense"}
                for kanji, kana, note in group["items"]
                if kanji != row["kanji"] and kana != row["kana"]
            ]
    return []


def kana_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if KANA_DISTANCE:
        try:
            distance = float(KANA_DISTANCE.calculate(left, right))
            longest = max(len(left), len(right), 1)
            return max(1 - distance / longest, 0)
        except Exception:
            pass
    if kanasim:
        for name in ("similarity", "kana_similarity", "get_similarity", "distance"):
            candidate = getattr(kanasim, name, None)
            if callable(candidate):
                try:
                    value = float(candidate(left, right))
                    return 1 / (1 + value) if value > 1 else max(min(value, 1), 0)
                except Exception:
                    pass
    return SequenceMatcher(None, left, right).ratio()


def confusion_threshold(kana: str) -> float:
    length = len(kana)
    if length <= 2:
        return 0.9
    if length == 3:
        return 0.82
    if length == 4:
        return 0.74
    return 0.68


def max_confusion_length_gap(kana: str) -> int:
    length = len(kana)
    if length <= 3:
        return 1
    if length <= 5:
        return 2
    return 3


def structural_similarity(left: str, right: str) -> float:
    score = SequenceMatcher(None, left, right).ratio()
    if left and right and left[0] == right[0]:
        score += 0.08
    if left and right and left[-1] == right[-1]:
        score += 0.08
    if len(left) == len(right):
        score += 0.06
    return min(score, 1.0)


def confusion_candidates(conn: sqlite3.Connection, row: sqlite3.Row) -> list[dict[str, str]]:
    candidates = conn.execute(
        """
        SELECT id, meaning, kana, kanji, pos, verb_type, importance
        FROM words
        WHERE id != ?
        """,
        (row["id"],),
    ).fetchall()
    scored = []
    current_pos = row["pos"].split("・")[0]
    current_kana = row["kana"]
    max_gap = max_confusion_length_gap(current_kana)
    threshold = confusion_threshold(current_kana)
    for candidate in candidates:
        candidate_kana = candidate["kana"]
        if abs(len(current_kana) - len(candidate_kana)) > max_gap:
            continue
        phonetic = kana_similarity(current_kana, candidate_kana)
        structural = structural_similarity(current_kana, candidate_kana)
        similarity = phonetic * 0.65 + structural * 0.35
        if current_pos and current_pos in candidate["pos"]:
            similarity += 0.04
        if row["verb_type"] and row["verb_type"] == candidate["verb_type"]:
            similarity += 0.04
        if similarity >= threshold:
            scored.append((similarity, candidate))
    scored.sort(key=lambda item: (item[0], item[1]["importance"]), reverse=True)
    phonetic_items = [
        {
            "kana": item["kana"],
            "kanji": item["kanji"],
            "meaning": item["meaning"],
            "kind": "sound",
        }
        for _, item in scored[:3]
    ]
    existing = {(item["kana"], item["kanji"]) for item in phonetic_items}
    sense_items = [
        item for item in sense_distinctions(row)
        if (item["kana"], item["kanji"]) not in existing
    ]
    return sense_items + phonetic_items


def word_note(conn: sqlite3.Connection | None, word_id: int) -> str:
    if not conn:
        return ""
    row = conn.execute("SELECT note FROM word_notes WHERE word_id = ?", (word_id,)).fetchone()
    return row["note"] if row else ""


def row_to_card(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    try:
        personal_mistake_score = mistake_score(row)
    except (IndexError, KeyError):
        personal_mistake_score = 0
    importance_score = min(max(row["importance"] * 1.4 + personal_mistake_score * 3, 0), 10)
    return {
        "id": row["id"],
        "meaning": row["meaning"],
        "questionMeaning": question_meaning(row["meaning"]),
        "primaryMeaning": primary_meaning(row["meaning"]),
        "promptMeaning": prompt_meaning(row["meaning"], row["id"], row["kanji"]),
        "honorificLabel": honorific_label(row["meaning"]),
        "kana": row["kana"],
        "kanji": row["kanji"],
        "englishOrigin": english_origin(row["kanji"], row["kana"], row["meaning"]),
        "pos": row["pos"],
        "score": round(row["score"], 1),
        "importance": row["importance"],
        "importanceScore": round(importance_score, 1),
        "note": word_note(conn, row["id"]),
        "example": {
            "jp": row["example_jp"] or "",
            "meaning": row["example_meaning"] or "",
        },
        "kanjiComponents": kanji_component_items(conn, row["kanji"]) if conn else [],
        "conjugations": conjugations(row),
        "verbPair": verb_pair_hint(conn, row) if conn else None,
        "confusions": confusion_candidates(conn, row) if conn else [],
    }


def card_by_id(conn: sqlite3.Connection, word_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT w.*, p.score
        FROM words w JOIN progress p ON p.word_id = w.id
        WHERE w.id = ?
        """,
        (word_id,),
    ).fetchone()
    return row_to_card(row, conn) if row else None


def card_by_id_any_progress(conn: sqlite3.Connection, word_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT w.*, COALESCE(p.score, 0) AS score,
               COALESCE(p.forgot_count, 0) AS forgot_count,
               COALESCE(p.fuzzy_count, 0) AS fuzzy_count,
               COALESCE(p.right_count, 0) AS right_count,
               COALESCE(p.mistake_streak, 0) AS mistake_streak
        FROM words w
        LEFT JOIN progress p ON p.word_id = w.id
        WHERE w.id = ?
        """,
        (word_id,),
    ).fetchone()
    return row_to_card(row, conn) if row else None


def seen_word_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "kana": row["kana"],
        "kanji": row["kanji"],
        "meaning": primary_meaning(row["meaning"]),
        "score": round(row["score"], 1),
        "seenCount": row["seen_count"],
        "rightCount": row["right_count"],
        "fuzzyCount": row["fuzzy_count"],
        "forgotCount": row["forgot_count"],
        "knownForever": bool(row["known_forever"]),
        "lastSeenOn": row["last_seen_on"] or "",
    }


def seen_words_page(conn: sqlite3.Connection, offset: int, limit: int, sort: str = "score_desc") -> dict:
    limit = min(max(limit, 1), 120)
    offset = max(offset, 0)
    order_options = {
        "score_desc": """
            p.known_forever ASC,
            p.score DESC,
            p.right_count DESC,
            p.forgot_count ASC,
            p.fuzzy_count ASC,
            p.seen_count DESC,
            p.last_seen_on ASC,
            w.kana ASC,
            w.id ASC
        """,
        "score_asc": """
            p.known_forever ASC,
            p.score ASC,
            p.forgot_count DESC,
            p.fuzzy_count DESC,
            p.seen_count DESC,
            p.last_seen_on ASC,
            w.kana ASC,
            w.id ASC
        """,
        "mistake_desc": """
            p.known_forever ASC,
            p.forgot_count DESC,
            p.fuzzy_count DESC,
            p.score ASC,
            p.seen_count DESC,
            p.last_seen_on ASC,
            w.kana ASC,
            w.id ASC
        """,
    }
    order_by = order_options.get(sort, order_options["score_desc"])
    where = """
        WHERE p.seen_count > 0
           OR EXISTS (
               SELECT 1 FROM moji_migrated_reviews m WHERE m.word_id = w.id
           )
    """
    total = conn.execute(
        f"""
        SELECT COUNT(*)
        FROM words w
        JOIN progress p ON p.word_id = w.id
        {where}
        """
    ).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT
            w.id,
            w.kana,
            w.kanji,
            w.meaning,
            p.score,
            p.seen_count,
            p.right_count,
            p.fuzzy_count,
            p.forgot_count,
            p.known_forever,
            p.last_seen_on
        FROM words w
        JOIN progress p ON p.word_id = w.id
        {where}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    ).fetchall()
    next_offset = offset + len(rows)
    return {
        "words": [seen_word_row(row) for row in rows],
        "total": total,
        "offset": offset,
        "nextOffset": next_offset,
        "hasMore": next_offset < total,
        "sort": sort if sort in order_options else "score_desc",
    }


def quick_grade_word(conn: sqlite3.Connection, word_id: int, answer: str) -> dict:
    today = TODAY()
    row = conn.execute(
        """
        SELECT
            w.id,
            w.kana,
            w.kanji,
            w.meaning,
            p.score,
            p.seen_count,
            p.low_history,
            p.known_forever,
            p.right_count,
            p.fuzzy_count,
            p.forgot_count,
            p.mistake_streak,
            p.last_seen_on
        FROM words w
        JOIN progress p ON p.word_id = w.id
        WHERE w.id = ?
        """,
        (word_id,),
    ).fetchone()
    if not row:
        raise ValueError("Word not found")

    queue = [item for item in get_review_queue(conn) if item.get("word_id") != word_id]
    set_review_queue(conn, queue)

    score = float(row["score"])
    known_forever = int(row["known_forever"])
    right_count = row["right_count"]
    fuzzy_count = row["fuzzy_count"]
    forgot_count = row["forgot_count"]
    mistake_streak = row["mistake_streak"]
    low_history = row["low_history"]
    seen_delta = 1

    if answer == "known_forever":
        known_forever = 1
        score = max(score, 10)
        mistake_streak = 0
        seen_delta = 0
    elif answer == "know":
        score += 10
        right_count += 1
        mistake_streak = 0
    elif answer == "fuzzy":
        score = max(score - 5, -40)
        fuzzy_count += 1
        mistake_streak += 1
    elif answer == "forgot":
        score = max(score - 10, -40)
        forgot_count += 1
        mistake_streak += 1
    else:
        raise ValueError("Invalid answer")

    if score <= CRITICAL_SCORE and not known_forever:
        low_history = 1
        record_critical_review(conn, word_id)

    mastered_on = today if score >= 10 and not known_forever else None
    conn.execute(
        """
        UPDATE progress
        SET score = ?,
            seen_count = seen_count + ?,
            low_history = ?,
            known_forever = ?,
            mastered_on = ?,
            last_seen_on = ?,
            right_count = ?,
            fuzzy_count = ?,
            forgot_count = ?,
            mistake_streak = ?
        WHERE word_id = ?
        """,
        (
            score,
            seen_delta,
            low_history,
            known_forever,
            mastered_on,
            today,
            right_count,
            fuzzy_count,
            forgot_count,
            mistake_streak,
            word_id,
        ),
    )
    conn.execute(
        "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
        (word_id, answer, score, today),
    )
    updated = conn.execute(
        """
        SELECT
            w.id,
            w.kana,
            w.kanji,
            w.meaning,
            p.score,
            p.seen_count,
            p.right_count,
            p.fuzzy_count,
            p.forgot_count,
            p.known_forever,
            p.last_seen_on
        FROM words w
        JOIN progress p ON p.word_id = w.id
        WHERE w.id = ?
        """,
        (word_id,),
    ).fetchone()
    return seen_word_row(updated)


def daily_new_quota(conn: sqlite3.Connection) -> int:
    first_day = date.fromisoformat(get_state(conn, "first_study_day", TODAY()))
    day_number = (study_date() - first_day).days + 1
    return 50 if day_number <= 3 else 20


def new_reviewed_today_count(conn: sqlite3.Connection) -> int:
    today = TODAY()
    return conn.execute(
        """
        SELECT COUNT(DISTINCT today_reviews.word_id)
        FROM reviews today_reviews
        WHERE today_reviews.reviewed_on = ?
          AND NOT EXISTS (
            SELECT 1
            FROM reviews earlier_reviews
            WHERE earlier_reviews.word_id = today_reviews.word_id
              AND earlier_reviews.reviewed_on < ?
          )
        """,
        (today, today),
    ).fetchone()[0]


def old_reviewed_today_count(conn: sqlite3.Connection) -> int:
    today = TODAY()
    return conn.execute(
        """
        SELECT COUNT(DISTINCT today_reviews.word_id)
        FROM reviews today_reviews
        WHERE today_reviews.reviewed_on = ?
          AND EXISTS (
            SELECT 1
            FROM reviews earlier_reviews
            WHERE earlier_reviews.word_id = today_reviews.word_id
              AND earlier_reviews.reviewed_on < ?
          )
        """,
        (today, today),
    ).fetchone()[0]


def stage1_task_count(conn: sqlite3.Connection, today: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",
        (today,),
    ).fetchone()[0]


def backfill_stage1_tasks_from_reviews(conn: sqlite3.Connection, today: str) -> None:
    rows = conn.execute(
        """
        SELECT
            today_reviews.word_id,
            MIN(today_reviews.id) AS first_review_id,
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM reviews earlier_reviews
                    WHERE earlier_reviews.word_id = today_reviews.word_id
                      AND earlier_reviews.reviewed_on < ?
                )
                THEN 'review'
                ELSE 'new'
            END AS task_type
        FROM reviews today_reviews
        WHERE today_reviews.reviewed_on = ?
        GROUP BY today_reviews.word_id
        ORDER BY first_review_id ASC
        """,
        (today, today),
    ).fetchall()
    for index, row in enumerate(rows, start=1):
        conn.execute(
            """
            INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
            VALUES (?, ?, ?, ?)
            """,
            (today, row["word_id"], row["task_type"], index),
        )


def activate_moji_migrated_reviews(conn: sqlite3.Connection, today: str) -> None:
    already_active_today = conn.execute(
        """
        SELECT COUNT(*)
        FROM moji_migrated_reviews
        WHERE activated_on = ?
        """,
        (today,),
    ).fetchone()[0]
    limit = max(MOJI_MIGRATION_REVIEW_CAP - already_active_today, 0)
    if limit <= 0:
        return
    conn.execute(
        """
        UPDATE moji_migrated_reviews
        SET activated_on = ?
        WHERE word_id IN (
            SELECT m.word_id
            FROM moji_migrated_reviews m
            JOIN progress p ON p.word_id = m.word_id
            JOIN words w ON w.id = m.word_id
            WHERE m.activated_on IS NULL
              AND p.known_forever = 0
              AND p.seen_count > 0
              AND p.score <= 6
            ORDER BY m.priority DESC, p.score ASC, w.importance DESC, m.word_id ASC
            LIMIT ?
        )
        """,
        (today, limit),
    )


def create_stage1_tasks(conn: sqlite3.Connection, today: str) -> None:
    if stage1_task_count(conn, today) > 0:
        return
    if conn.execute("SELECT 1 FROM reviews WHERE reviewed_on = ? LIMIT 1", (today,)).fetchone():
        backfill_stage1_tasks_from_reviews(conn, today)
        return

    activate_moji_migrated_reviews(conn, today)

    order_index = 1
    review_rows = conn.execute(
        """
        SELECT p.word_id
        FROM progress p
        JOIN words w ON w.id = p.word_id
        LEFT JOIN moji_migrated_reviews m ON m.word_id = p.word_id
        WHERE p.known_forever = 0
          AND p.seen_count > 0
          AND p.score <= 6
          AND (m.word_id IS NULL OR m.activated_on IS NOT NULL)
        ORDER BY
            CASE WHEN m.word_id IS NULL THEN 0 ELSE 1 END ASC,
            p.score ASC,
            p.low_history DESC,
            w.importance DESC,
            COALESCE(m.priority, 0) DESC,
            p.last_seen_on ASC,
            p.word_id ASC
        """
    ).fetchall()
    for row in review_rows:
        conn.execute(
            """
            INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
            VALUES (?, ?, 'review', ?)
            """,
            (today, row["word_id"], order_index),
        )
        order_index += 1

    new_rows = conn.execute(
        """
        SELECT p.word_id
        FROM progress p
        JOIN words w ON w.id = p.word_id
        WHERE p.known_forever = 0
          AND p.seen_count = 0
        ORDER BY w.shuffle_rank DESC, w.importance DESC, p.word_id ASC
        LIMIT ?
        """,
        (daily_new_quota(conn),),
    ).fetchall()
    for row in new_rows:
        conn.execute(
            """
            INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
            VALUES (?, ?, 'new', ?)
            """,
            (today, row["word_id"], order_index),
        )
        order_index += 1


def ensure_stage1_tasks(conn: sqlite3.Connection) -> None:
    today = TODAY()
    create_stage1_tasks(conn, today)


def stage1_progress_counts(conn: sqlite3.Connection) -> tuple[int, int]:
    today = TODAY()
    ensure_stage1_tasks(conn)
    total = stage1_task_count(conn, today)
    completed = conn.execute(
        """
        SELECT SUM(
            CASE
                WHEN p.known_forever = 1 THEN 1
                WHEN p.score > 6 THEN 1
                ELSE 0
            END
        )
        FROM stage1_tasks t
        JOIN progress p ON p.word_id = t.word_id
        LEFT JOIN (
            SELECT word_id, COUNT(*) AS seen_count
            FROM reviews
            WHERE reviewed_on = ?
            GROUP BY word_id
        ) today_seen ON today_seen.word_id = t.word_id
        WHERE t.reviewed_on = ?
        """,
        (today, today),
    ).fetchone()[0] or 0
    return min(int(completed), total), total


def days_since(date_text: str | None) -> int:
    if not date_text:
        return 0
    try:
        return max((study_date() - date.fromisoformat(date_text)).days, 0)
    except ValueError:
        return 0


def priority_components(
    row: sqlite3.Row,
    *,
    due_after: int | None,
    critical_count: int,
    new_quota_left: int,
) -> dict[str, float]:
    is_new = row["seen_count"] == 0
    score = float(row["score"])
    components = {
        "score": 0.0,
        "critical": 0.0,
        "importance": float(row["importance"] * 7),
        "mistake": float(row["forgot_count"] * 14 + row["fuzzy_count"] * 7 + row["mistake_streak"] * 12 - row["right_count"] * 3),
        "queue": 0.0,
        "age": float(min(days_since(row["last_seen_on"]) * 3, 30)),
        "new": 0.0,
        "jitter": random.uniform(0, 8),
    }

    if is_new:
        components["new"] = 45 + min(new_quota_left, 10)
        components["score"] = 18
        components["shuffle"] = float(row["shuffle_rank"] * 18)
        components["importance"] = float(row["importance"] * 4)
    else:
        components["score"] = max((10 - score) * 5, 0)

    if score <= CRITICAL_SCORE:
        components["critical"] = 120 + max(critical_count - 3, 0) * 80
    elif critical_count > 3:
        components["critical"] = -1000

    if due_after is not None:
        if due_after <= 0:
            components["queue"] = 45
        else:
            components["queue"] = -80 - due_after * 25

    return components


def priority_score(components: dict[str, float]) -> float:
    return sum(components.values())


def critical_pool_size(count: int) -> int:
    return min(max(count, 3), 5)


def pick_due_critical_pool_row(rows: list[sqlite3.Row], *, score_key: str = "score") -> sqlite3.Row | None:
    has_floor_word = any(float(row[score_key]) <= -40 for row in rows)
    if not has_floor_word:
        return None
    low_rows = list(rows)
    if not low_rows:
        return None
    low_rows.sort(
        key=lambda row: (
            float(row[score_key]),
            row["today_seen_count"] if "today_seen_count" in row.keys() else row["seen_count"],
            row["order_index"],
        )
    )
    pool = low_rows[:critical_pool_size(len(low_rows))]
    due_pool = [
        row for row in pool
        if row["due_after"] is None or int(row["due_after"]) <= 0
    ]
    if not due_pool:
        return None
    return min(
        due_pool,
        key=lambda row: (
            row["today_seen_count"] if "today_seen_count" in row.keys() else row["seen_count"],
            float(row[score_key]),
            row["order_index"],
        ),
    )


def pick_stage1_critical_pool_row(rows: list[sqlite3.Row], queue_by_id: dict[int, int]) -> sqlite3.Row | None:
    has_floor_word = any(float(row["score"]) <= -40 for row in rows)
    if not has_floor_word:
        return None
    low_rows = list(rows)
    if not low_rows:
        return None
    low_rows.sort(key=lambda row: (float(row["score"]), row["today_seen_count"], row["order_index"]))
    pool = low_rows[:critical_pool_size(len(low_rows))]
    due_pool = [
        row for row in pool
        if queue_by_id.get(row["id"], 0) <= 0
    ]
    if not due_pool:
        return None
    return min(
        due_pool,
        key=lambda row: (
            queue_by_id.get(row["id"], 0),
            row["today_seen_count"],
            float(row["score"]),
            row["order_index"],
        ),
    )


def pick_stage1_next(conn: sqlite3.Connection) -> dict | None:
    today = TODAY()
    ensure_stage1_tasks(conn)
    queue_by_id = {
        int(item["word_id"]): int(item.get("due_after", 0))
        for item in get_review_queue(conn)
        if item.get("word_id") is not None
    }
    new_quota_left = conn.execute(
        """
        SELECT COUNT(*)
        FROM stage1_tasks t
        JOIN progress p ON p.word_id = t.word_id
        WHERE t.reviewed_on = ?
          AND t.task_type = 'new'
          AND p.seen_count = 0
          AND p.known_forever = 0
        """,
        (today,),
    ).fetchone()[0]
    critical_count = conn.execute(
        """
        SELECT COUNT(*)
        FROM stage1_tasks t
        JOIN progress p ON p.word_id = t.word_id
        WHERE t.reviewed_on = ?
          AND p.known_forever = 0
          AND p.score <= ?
        """,
        (today, CRITICAL_SCORE),
    ).fetchone()[0]
    rows = conn.execute(
        """
        SELECT
            w.*,
            p.word_id,
            p.score,
            p.seen_count,
            p.low_history,
            p.known_forever,
            p.mastered_on,
            p.last_seen_on,
            p.right_count,
            p.fuzzy_count,
            p.forgot_count,
            p.mistake_streak,
            p.last_decay_amount,
            t.task_type,
            t.order_index,
            COALESCE(today_seen.seen_count, 0) AS today_seen_count
        FROM stage1_tasks t
        JOIN words w ON w.id = t.word_id
        JOIN progress p ON p.word_id = t.word_id
        LEFT JOIN (
            SELECT word_id, COUNT(*) AS seen_count
            FROM reviews
            WHERE reviewed_on = ?
            GROUP BY word_id
        ) today_seen ON today_seen.word_id = t.word_id
        WHERE t.reviewed_on = ?
          AND p.known_forever = 0
          AND (
              (t.task_type = 'new' AND p.seen_count = 0)
              OR p.score <= 6
          )
        """,
        (today, today),
    ).fetchall()

    critical_pool_row = pick_stage1_critical_pool_row(rows, queue_by_id)
    if critical_pool_row:
        card = row_to_card(critical_pool_row, conn)
        card["priority"] = {
            "total": 9999,
            "components": {"critical_pool": 9999},
        }
        return card

    candidates = []
    for row in rows:
        components = priority_components(
            row,
            due_after=queue_by_id.get(row["id"]),
            critical_count=critical_count,
            new_quota_left=new_quota_left,
        )
        candidates.append((priority_score(components), components, row))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    best_score, components, row = candidates[0]
    card = row_to_card(row, conn)
    card["priority"] = {
        "total": round(best_score, 2),
        "components": {key: round(value, 2) for key, value in components.items()},
    }
    return card


def next_card(conn: sqlite3.Connection) -> tuple[dict | None, str]:
    card, phase = _resolve_next_card(conn)
    set_current_card(conn, card)
    return card, phase


def _resolve_next_card(conn: sqlite3.Connection) -> tuple[dict | None, str]:
    phase = current_phase(conn)
    if phase == "done":
        return None, "done"
    if phase == "checkin":
        return None, "checkin"
    if phase == "stage2":
        card = pick_stage2_next(conn)
        if card:
            return card, "stage2"
        set_phase(conn, "done")
        return None, "done"
    if phase == "kanji":
        card = pick_kanji_next(conn)
        if card:
            return card, "kanji"
        set_phase(conn, "checkin")
        return None, "checkin"

    card = pick_stage1_next(conn)
    if card:
        return card, "stage1"

    stage2 = stage2_stats(conn)
    if stage2["total"] > 0 and stage2["completed"] < stage2["total"]:
        record_checkin(conn)
        set_phase(conn, "checkin")
        return None, "checkin"
    record_checkin(conn)
    return None, "done"


def stats(conn: sqlite3.Connection) -> dict:
    today = TODAY()
    quota = daily_new_quota(conn)
    new_today = new_reviewed_today_count(conn)
    old_today = old_reviewed_today_count(conn)
    stage1_progress_done, stage1_progress_total = stage1_progress_counts(conn)
    phase = current_phase(conn)
    stage2 = stage2_stats(conn)
    kanji = kanji_stats(conn)
    total = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
    known = conn.execute("SELECT COUNT(*) FROM progress WHERE known_forever = 1").fetchone()[0]
    mastered_today = conn.execute(
        "SELECT COUNT(*) FROM progress WHERE mastered_on = ?",
        (today,),
    ).fetchone()[0]
    reviewed_today = conn.execute(
        "SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ?",
        (today,),
    ).fetchone()[0]
    low = conn.execute(
        """
        SELECT COUNT(*)
        FROM progress p
        LEFT JOIN moji_migrated_reviews m ON m.word_id = p.word_id
        WHERE p.known_forever = 0
          AND p.seen_count > 0
          AND p.score <= 6
          AND (m.word_id IS NULL OR m.activated_on IS NOT NULL)
        """
    ).fetchone()[0]
    moji_pending = conn.execute(
        """
        SELECT COUNT(*)
        FROM moji_migrated_reviews m
        JOIN progress p ON p.word_id = m.word_id
        WHERE m.activated_on IS NULL
          AND p.known_forever = 0
          AND p.seen_count > 0
          AND p.score <= 6
        """
    ).fetchone()[0]
    unseen = conn.execute(
        "SELECT COUNT(*) FROM progress WHERE known_forever = 0 AND seen_count = 0"
    ).fetchone()[0]
    stage1_done = stage1_progress_total > 0 and stage1_progress_done >= stage1_progress_total
    task_done = stage2["total"] > 0 and stage2["completed"] >= stage2["total"]
    return {
        "total": total,
        "knownForever": known,
        "masteredToday": mastered_today,
        "reviewedToday": reviewed_today,
        "lowCount": low,
        "mojiPendingReviewCount": moji_pending,
        "unseenCount": unseen,
        "newToday": new_today,
        "oldToday": old_today,
        "newQuota": quota,
        "stage1ProgressDone": stage1_progress_done,
        "stage1ProgressTotal": stage1_progress_total,
        "phase": phase,
        "stage1Done": stage1_done,
        "stage2Total": stage2["total"],
        "stage2Completed": stage2["completed"],
        "kanjiTotal": kanji["total"],
        "kanjiCompleted": kanji["completed"],
        "studyDate": today,
        "checkins": checkin_days(conn),
        "dailyStudyStats": daily_study_stats(conn),
        "wordStudySecondsToday": word_study_seconds(conn, today),
        "taskDone": task_done,
        "difficultWords": difficult_words(conn),
        "settings": settings_payload(conn),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR / "static"), **kwargs)

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/next":
            with connect() as conn:
                apply_daily_decay(conn)
                card, phase = next_card(conn)
                self.send_json({"card": card, "phase": phase, "stats": stats(conn)})
            return
        if path == "/api/stats":
            with connect() as conn:
                apply_daily_decay(conn)
                self.send_json({"stats": stats(conn)})
            return
        if path == "/api/settings":
            with connect() as conn:
                self.send_json({"settings": settings_payload(conn)})
            return
        if path == "/api/seen-words":
            query = parse_qs(parsed.query)
            offset = int(query.get("offset", ["0"])[0] or 0)
            limit = int(query.get("limit", ["80"])[0] or 80)
            sort = query.get("sort", ["score_desc"])[0] or "score_desc"
            with connect() as conn:
                apply_daily_decay(conn)
                self.send_json(seen_words_page(conn, offset, limit, sort))
            return
        if path == "/api/grammar/next":
            query = parse_qs(parsed.query)
            level = query.get("level", ["All"])[0] or "All"
            mode = query.get("mode", [""])[0]
            with connect() as conn:
                apply_grammar_daily_decay(conn)
                # 考题阶段:mode=random 时纯随机抽题,不走 SRS 推词
                card = pick_grammar_random(conn, level) if mode == "random" else pick_grammar_next(conn, level)
                self.send_json({"card": card, "stats": grammar_stats(conn, level)})
            return
        if path == "/api/grammar/review":
            query = parse_qs(parsed.query)
            level = query.get("level", ["All"])[0] or "All"
            with connect() as conn:
                apply_grammar_daily_decay(conn)
                self.send_json({"items": grammar_review_list(conn, level)})
            return
        if path == "/api/grammar/stats":
            query = parse_qs(parsed.query)
            level = query.get("level", ["All"])[0] or "All"
            with connect() as conn:
                apply_grammar_daily_decay(conn)
                self.send_json({"stats": grammar_stats(conn, level)})
            return
        if path == "/grammar":
            self.path = "/grammar.html"
            super().do_GET()
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        if path == "/api/word-study-time":
            seconds = int(payload.get("seconds", 0) or 0)
            with connect() as conn:
                total = add_word_study_seconds(conn, seconds)
                self.send_json({"seconds": total, "stats": stats(conn)})
            return

        if path == "/api/settings":
            auto_known = payload.get("autoKnownEnabled")
            if not isinstance(auto_known, bool):
                self.send_json({"error": "Invalid settings"}, 400)
                return
            with connect() as conn:
                set_state(conn, "auto_known_enabled", "1" if auto_known else "0")
                self.send_json({"settings": settings_payload(conn), "stats": stats(conn)})
            return

        if path == "/api/word-note":
            word_id = int(payload.get("wordId", 0) or 0)
            note = str(payload.get("note", "")).strip()
            if word_id <= 0:
                self.send_json({"error": "Invalid word"}, 400)
                return
            with connect() as conn:
                exists = conn.execute("SELECT 1 FROM words WHERE id = ?", (word_id,)).fetchone()
                if not exists:
                    self.send_json({"error": "Word not found"}, 404)
                    return
                if note:
                    conn.execute(
                        """
                        INSERT INTO word_notes (word_id, note, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(word_id) DO UPDATE SET
                            note = excluded.note,
                            updated_at = excluded.updated_at
                        """,
                        (word_id, note),
                    )
                else:
                    conn.execute("DELETE FROM word_notes WHERE word_id = ?", (word_id,))
                self.send_json({"wordId": word_id, "note": note})
            return

        if path == "/api/undo":
            with connect() as conn:
                snapshot = get_state(conn, "last_answer", "")
                if not snapshot:
                    card, phase = next_card(conn)
                    self.send_json({"card": card, "phase": phase, "stats": stats(conn), "undone": False})
                    return
                previous = json.loads(snapshot)
                if previous.get("phase") == "stage2":
                    conn.execute(
                        """
                        UPDATE stage2_progress
                        SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
                        WHERE reviewed_on = ? AND word_id = ?
                        """,
                        (
                            previous["temp_score"],
                            previous["seen_count"],
                            previous["completed"],
                            previous["due_after"],
                            previous["reviewed_on"],
                            previous["word_id"],
                        ),
                    )
                    set_phase(conn, "stage2")
                    delete_state(conn, "last_answer")
                    set_state(conn, "current_card", str(previous["word_id"]))
                    self.send_json(
                        {
                            "card": stage2_card_by_id(conn, previous["word_id"]),
                            "phase": "stage2",
                            "stats": stats(conn),
                            "undone": True,
                        }
                    )
                    return
                if previous.get("phase") == "kanji":
                    conn.execute(
                        """
                        UPDATE kanji_progress
                        SET temp_score = ?, seen_count = ?, completed = ?, due_after = ?
                        WHERE reviewed_on = ? AND word_id = ?
                        """,
                        (
                            previous["temp_score"],
                            previous["seen_count"],
                            previous["completed"],
                            previous["due_after"],
                            previous["reviewed_on"],
                            previous["word_id"],
                        ),
                    )
                    if previous.get("memory_exists"):
                        conn.execute(
                            """
                            INSERT INTO kanji_memory (
                                word_id, score, seen_count, right_count,
                                fuzzy_count, forgot_count, low_history, last_seen_on
                            )
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(word_id) DO UPDATE SET
                                score = excluded.score,
                                seen_count = excluded.seen_count,
                                right_count = excluded.right_count,
                                fuzzy_count = excluded.fuzzy_count,
                                forgot_count = excluded.forgot_count,
                                low_history = excluded.low_history,
                                last_seen_on = excluded.last_seen_on
                            """,
                            (
                                previous["word_id"],
                                previous["memory_score"],
                                previous["memory_seen_count"],
                                previous["memory_right_count"],
                                previous["memory_fuzzy_count"],
                                previous["memory_forgot_count"],
                                previous["memory_low_history"],
                                previous["memory_last_seen_on"],
                            ),
                        )
                    else:
                        conn.execute("DELETE FROM kanji_memory WHERE word_id = ?", (previous["word_id"],))
                    set_phase(conn, "kanji")
                    delete_state(conn, "last_answer")
                    set_state(conn, "current_card", str(previous["word_id"]))
                    self.send_json(
                        {
                            "card": kanji_card_by_id(conn, previous["word_id"]),
                            "phase": "kanji",
                            "stats": stats(conn),
                            "undone": True,
                        }
                    )
                    return
                conn.execute(
                    """
                    UPDATE progress
                    SET score = ?, seen_count = ?, low_history = ?,
                        known_forever = ?, mastered_on = ?, last_seen_on = ?,
                        right_count = ?, fuzzy_count = ?, forgot_count = ?,
                        mistake_streak = ?
                    WHERE word_id = ?
                    """,
                    (
                        previous["score"],
                        previous["seen_count"],
                        previous["low_history"],
                        previous["known_forever"],
                        previous["mastered_on"],
                        previous["last_seen_on"],
                        previous["right_count"],
                        previous["fuzzy_count"],
                        previous["forgot_count"],
                        previous["mistake_streak"],
                        previous["word_id"],
                    ),
                )
                if previous.get("review_id"):
                    conn.execute("DELETE FROM reviews WHERE id = ?", (previous["review_id"],))
                restore_auto_known_row(conn, previous)
                set_review_queue(conn, previous.get("review_queue", []))
                delete_state(conn, "last_answer")
                set_state(conn, "current_card", str(previous["word_id"]))
                self.send_json(
                    {
                        "card": card_by_id(conn, previous["word_id"]),
                        "phase": "stage1",
                        "stats": stats(conn),
                        "undone": True,
                    }
                )
            return

        if path == "/api/continue-stage2":
            with connect() as conn:
                stage2 = stage2_stats(conn)
                if stage2["total"] > 0 and stage2["completed"] < stage2["total"]:
                    set_phase(conn, "stage2")
                    card, phase = next_card(conn)
                    self.send_json({"card": card, "phase": phase, "stats": stats(conn)})
                    return
                set_phase(conn, "done")
                self.send_json({"card": None, "phase": "done", "stats": stats(conn)})
            return

        if path == "/api/continue-kanji":
            with connect() as conn:
                build_kanji_progress_from_reviews(conn)
                kanji = kanji_stats(conn)
                if kanji["total"] > 0 and kanji["completed"] < kanji["total"]:
                    set_phase(conn, "kanji")
                    card, phase = next_card(conn)
                    self.send_json({"card": card, "phase": phase, "stats": stats(conn)})
                    return
                set_phase(conn, "checkin")
                self.send_json({"card": None, "phase": "checkin", "stats": stats(conn)})
            return

        if path == "/api/return-checkin":
            with connect() as conn:
                phase = current_phase(conn)
                if phase in {"stage2", "kanji", "done"}:
                    set_phase(conn, "checkin")
                self.send_json({"card": None, "phase": "checkin", "stats": stats(conn)})
            return

        if path == "/api/quick-grade":
            answer = payload.get("answer")
            word_id = int(payload.get("wordId", 0))
            if answer not in {"forgot", "fuzzy", "know", "known_forever"} or word_id <= 0:
                self.send_json({"error": "Invalid answer"}, 400)
                return
            with connect() as conn:
                try:
                    word = quick_grade_word(conn, word_id, answer)
                except ValueError as error:
                    self.send_json({"error": str(error)}, 404)
                    return
                self.send_json({"word": word, "stats": stats(conn)})
            return

        if path == "/api/kanji-mark":
            char = str(payload.get("char", ""))[:1]
            marked = payload.get("marked")
            if not char or not has_kanji(char) or marked not in {True, False}:
                self.send_json({"error": "Invalid kanji mark"}, 400)
                return
            with connect() as conn:
                variants = kanji_variants()
                simplified = variants.get(char, char)
                conn.execute(
                    """
                    INSERT INTO kanji_char_overrides (char, marked, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(char) DO UPDATE SET
                        marked = excluded.marked,
                        updated_at = excluded.updated_at
                    """,
                    (char, 1 if marked else 0),
                )
                self.send_json(
                    {
                        "component": {
                            "char": char,
                            "simplified": simplified,
                            "marked": bool(marked),
                            "source": "manual",
                        }
                    }
                )
            return

        if path == "/api/update-meaning":
            word_id = int(payload.get("wordId", 0))
            meaning = clean_text(str(payload.get("meaning", "")).strip())
            if word_id <= 0 or not meaning or len(meaning) > 300:
                self.send_json({"error": "Invalid meaning"}, 400)
                return
            with connect() as conn:
                exists = conn.execute("SELECT 1 FROM words WHERE id = ?", (word_id,)).fetchone()
                if not exists:
                    self.send_json({"error": "Word not found"}, 404)
                    return
                conn.execute("UPDATE words SET meaning = ? WHERE id = ?", (meaning, word_id))
                card = card_by_id_any_progress(conn, word_id)
                self.send_json({"card": card, "stats": stats(conn)})
            return

        if path == "/api/grammar/answer":
            answer = payload.get("answer")
            grammar_id = int(payload.get("grammarId", 0))
            level = str(payload.get("level", "All") or "All")
            if answer not in {"forgot", "fuzzy", "know", "known_forever"} or grammar_id <= 0:
                self.send_json({"error": "Invalid answer"}, 400)
                return
            with connect() as conn:
                apply_grammar_daily_decay(conn)
                try:
                    self.send_json(answer_grammar(conn, grammar_id, answer, level))
                except ValueError as error:
                    self.send_json({"error": str(error)}, 404)
            return

        if path != "/api/answer":
            self.send_json({"error": "Not found"}, 404)
            return
        answer = payload.get("answer")
        word_id = int(payload.get("wordId", 0))
        if answer not in {"forgot", "fuzzy", "know", "known_forever"} or word_id <= 0:
            self.send_json({"error": "Invalid answer"}, 400)
            return

        with connect() as conn:
            today = TODAY()
            if not claim_current_card(conn, word_id):
                # Stale or duplicate submission (e.g. a rapid double-click or
                # key-repeat that fired before the card advanced). Do NOT score
                # the word again; just re-sync the client with the current card.
                card, phase = next_card(conn)
                self.send_json(
                    {"card": card, "phase": phase, "stats": stats(conn), "duplicate": True}
                )
                return
            phase = current_phase(conn)
            if phase == "stage2":
                current = conn.execute(
                    """
                    SELECT * FROM stage2_progress
                    WHERE reviewed_on = ? AND word_id = ?
                    """,
                    (today, word_id),
                ).fetchone()
                if not current:
                    self.send_json({"error": "Stage 2 word not found"}, 404)
                    return
                advance_stage2_queue(conn, word_id)
                snapshot = {
                    "phase": "stage2",
                    "reviewed_on": today,
                    "word_id": word_id,
                    "temp_score": current["temp_score"],
                    "seen_count": current["seen_count"],
                    "completed": current["completed"],
                    "due_after": current["due_after"],
                }
                delta = {"forgot": -10, "fuzzy": -5, "know": 10, "known_forever": 10}[answer]
                temp_score = max(current["temp_score"] + delta, -40)
                completed = 1 if temp_score >= 10 else 0
                due_after = None if completed else random.randint(4, 8)
                conn.execute(
                    """
                    UPDATE stage2_progress
                    SET temp_score = ?, seen_count = seen_count + 1,
                        completed = ?, due_after = ?
                    WHERE reviewed_on = ? AND word_id = ?
                    """,
                    (temp_score, completed, due_after, today, word_id),
                )
                set_state(conn, "last_answer", json.dumps(snapshot, ensure_ascii=False))
                card, response_phase = next_card(conn)
                self.send_json({"card": card, "phase": response_phase, "stats": stats(conn)})
                return

            if phase == "kanji":
                current = conn.execute(
                    """
                    SELECT * FROM kanji_progress
                    WHERE reviewed_on = ? AND word_id = ?
                    """,
                    (today, word_id),
                ).fetchone()
                if not current:
                    self.send_json({"error": "Kanji word not found"}, 404)
                    return
                advance_kanji_queue(conn, word_id)
                snapshot = {
                    "phase": "kanji",
                    "reviewed_on": today,
                    "word_id": word_id,
                    "temp_score": current["temp_score"],
                    "seen_count": current["seen_count"],
                    "completed": current["completed"],
                    "due_after": current["due_after"],
                }
                memory = conn.execute(
                    "SELECT * FROM kanji_memory WHERE word_id = ?",
                    (word_id,),
                ).fetchone()
                snapshot.update(
                    {
                        "memory_exists": bool(memory),
                        "memory_score": memory["score"] if memory else 0,
                        "memory_seen_count": memory["seen_count"] if memory else 0,
                        "memory_right_count": memory["right_count"] if memory else 0,
                        "memory_fuzzy_count": memory["fuzzy_count"] if memory else 0,
                        "memory_forgot_count": memory["forgot_count"] if memory else 0,
                        "memory_low_history": memory["low_history"] if memory else 0,
                        "memory_last_seen_on": memory["last_seen_on"] if memory else None,
                    }
                )
                memory_score = memory["score"] if memory else 0
                delta = {"forgot": -10, "fuzzy": -5, "know": 10, "known_forever": 10}[answer]
                temp_score = max(current["temp_score"] + delta, -40)
                memory_score = max(memory_score + delta, -40)
                completed = 1 if temp_score >= 10 else 0
                low_history = 1 if memory_score <= CRITICAL_SCORE or (memory and memory["low_history"]) else 0
                due_after = None if completed else random.randint(2, 4) if temp_score <= CRITICAL_SCORE else random.randint(4, 8)
                conn.execute(
                    """
                    UPDATE kanji_progress
                    SET temp_score = ?, seen_count = seen_count + 1,
                        completed = ?, due_after = ?
                    WHERE reviewed_on = ? AND word_id = ?
                    """,
                    (temp_score, completed, due_after, today, word_id),
                )
                conn.execute(
                    """
                    INSERT INTO kanji_memory (
                        word_id, score, seen_count, right_count,
                        fuzzy_count, forgot_count, low_history, last_seen_on
                    )
                    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT(word_id) DO UPDATE SET
                        score = excluded.score,
                        seen_count = kanji_memory.seen_count + 1,
                        right_count = kanji_memory.right_count + excluded.right_count,
                        fuzzy_count = kanji_memory.fuzzy_count + excluded.fuzzy_count,
                        forgot_count = kanji_memory.forgot_count + excluded.forgot_count,
                        low_history = MAX(kanji_memory.low_history, excluded.low_history),
                        last_seen_on = excluded.last_seen_on
                    """,
                    (
                        word_id,
                        memory_score,
                        1 if answer in {"know", "known_forever"} else 0,
                        1 if answer == "fuzzy" else 0,
                        1 if answer == "forgot" else 0,
                        low_history,
                        today,
                    ),
                )
                set_state(conn, "last_answer", json.dumps(snapshot, ensure_ascii=False))
                card, response_phase = next_card(conn)
                self.send_json({"card": card, "phase": response_phase, "stats": stats(conn)})
                return

            progress = conn.execute(
                "SELECT * FROM progress WHERE word_id = ?",
                (word_id,),
            ).fetchone()
            if not progress:
                self.send_json({"error": "Word not found"}, 404)
                return
            stage1_task = conn.execute(
                """
                SELECT task_type
                FROM stage1_tasks
                WHERE reviewed_on = ? AND word_id = ?
                """,
                (today, word_id),
            ).fetchone()
            task_type = stage1_task["task_type"] if stage1_task else "review"
            advance_review_queue(conn, word_id)
            previous_auto_known = auto_known_row(conn, word_id)
            snapshot = {
                "phase": "stage1",
                "word_id": word_id,
                "score": progress["score"],
                "seen_count": progress["seen_count"],
                "low_history": progress["low_history"],
                "known_forever": progress["known_forever"],
                "mastered_on": progress["mastered_on"],
                "last_seen_on": progress["last_seen_on"],
                "right_count": progress["right_count"],
                "fuzzy_count": progress["fuzzy_count"],
                "forgot_count": progress["forgot_count"],
                "mistake_streak": progress["mistake_streak"],
                "task_type": task_type,
                "review_queue": get_review_queue(conn),
                "auto_known_row": {key: previous_auto_known[key] for key in previous_auto_known.keys()} if previous_auto_known else None,
            }
            score = progress["score"]
            known_forever = progress["known_forever"]
            auto_known = None
            first_seen_today = conn.execute(
                "SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ?",
                (word_id, today),
            ).fetchone()[0] == 0
            if answer == "known_forever":
                known_forever = 1
                right_count = progress["right_count"]
                fuzzy_count = progress["fuzzy_count"]
                forgot_count = progress["forgot_count"]
                mistake_streak = 0
            else:
                # First "know" of the day on a word earns a +5 first-impression
                # bonus (+15 instead of +10). Only the day's first sighting counts;
                # fuzzy/forgot and later sightings are unchanged.
                if answer == "know" and first_seen_today:
                    delta = 15
                else:
                    delta = {"forgot": -10, "fuzzy": -5, "know": 10}[answer]
                score = max(score + delta, -40)
                right_count = progress["right_count"] + (1 if answer == "know" else 0)
                fuzzy_count = progress["fuzzy_count"] + (1 if answer == "fuzzy" else 0)
                forgot_count = progress["forgot_count"] + (1 if answer == "forgot" else 0)
                mistake_streak = 0 if answer == "know" else progress["mistake_streak"] + 1
                if first_seen_today:
                    auto_known = update_first_seen_streak(
                        conn,
                        word_id,
                        today,
                        answer,
                        enabled=auto_known_enabled(conn),
                        already_known=bool(progress["known_forever"]),
                    )
                    if auto_known:
                        known_forever = 1
                        score = max(score, 10)
            low_history = progress["low_history"] or 0
            if score <= CRITICAL_SCORE:
                low_history = 1
            if score <= CRITICAL_SCORE and not known_forever:
                record_critical_review(conn, word_id)
            mastered_on = today if score >= 10 and not known_forever else None
            if score <= 6 and not known_forever:
                schedule_delayed_review(conn, word_id)
            if answer != "known_forever" and not auto_known:
                record_stage2_word(conn, word_id)
            conn.execute(
                """
                UPDATE progress
                SET score = ?, seen_count = seen_count + 1, low_history = ?,
                    known_forever = ?, mastered_on = ?, last_seen_on = ?,
                    right_count = ?, fuzzy_count = ?, forgot_count = ?,
                    mistake_streak = ?
                WHERE word_id = ?
                """,
                (
                    score,
                    low_history,
                    known_forever,
                    mastered_on,
                    today,
                    right_count,
                    fuzzy_count,
                    forgot_count,
                    mistake_streak,
                    word_id,
                ),
            )
            cursor = conn.execute(
                "INSERT INTO reviews (word_id, answer, score_after, reviewed_on) VALUES (?, ?, ?, ?)",
                (word_id, answer, score, today),
            )
            snapshot["review_id"] = cursor.lastrowid
            set_state(conn, "last_answer", json.dumps(snapshot, ensure_ascii=False))
            card, response_phase = next_card(conn)
            self.send_json({"card": card, "phase": response_phase, "stats": stats(conn), "autoKnown": auto_known})


def main() -> None:
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("日语背词网页已启动：http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
