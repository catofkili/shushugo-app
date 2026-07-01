#!/usr/bin/env python3
"""
合并 PDF 提取的 N5/N3 语法数据到 grammar.ts 与 seed_grammar.py。

- 读取现有 src/data/grammar.ts 的 grammarPoints（含已有 N4，完整格式）。
- 读取 /tmp 下的提取数据（n5_*.json / n3_*.json）：字段为
  id,title,level,meaning,structure,explanation,examples,comparisons（无 quizzes）。
- 为新条目自动生成一道选择题 quiz（与现有 N4 同款）。
- 合并后按 N5 → N4 → N3 排序写回 grammar.ts。
- 同步重写 seed_grammar.py 的 GRAMMAR_POINTS，并升级 GRAMMAR_DATASET_VERSION。

用法： python3 tools/merge_grammar.py [extract_json ...]
不带参数时默认读取 /tmp/n5_grammar.json /tmp/n5_part*.json /tmp/n3_*.json
"""
from __future__ import annotations
import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAMMAR_TS = ROOT / "src" / "data" / "grammar.ts"
SEED_PY = ROOT / "seed_grammar.py"
DATASET_VERSION = "2026-06-24-pdf-n345"

LEVEL_ORDER = {"N5": 0, "N4": 1, "N3": 2, "N2": 3, "N1": 4}

DISTRACTORS = ["表示单纯的时间顺序", "表示比较的最高级", "表示并列罗列名词", "表示动作的被动"]


def load_existing() -> tuple[list[dict], str]:
    """返回 (现有 grammarPoints, grammarPoints 数组之后的原样尾部内容)。"""
    content = GRAMMAR_TS.read_text(encoding="utf-8")
    m = re.search(
        r"export const grammarPoints: GrammarPoint\[\] = (\[[\s\S]*?\n\]);\n",
        content,
    )
    if not m:
        raise SystemExit("无法在 grammar.ts 中找到 grammarPoints 数组")
    data_str = re.sub(r",(\s*[}\]])", r"\1", m.group(1))
    tail = content[m.end():]  # presetComparisons 等其它导出，原样保留
    return json.loads(data_str), tail


def make_quiz(item: dict) -> list[dict]:
    title = item["title"]
    meaning = item["meaning"]
    options = [meaning] + [d for d in DISTRACTORS if d != meaning][:3]
    return [{
        "id": f"{item['id']}-q1",
        "type": "choice",
        "prompt": f"「{title}」主要表示什么？",
        "options": options,
        "answer": meaning,
        "explanation": f"「{title}」：{meaning}。",
    }]


def normalize(item: dict) -> dict:
    out = {
        "id": item["id"],
        "title": item["title"],
        "level": item["level"],
        "meaning": item["meaning"],
        "structure": item.get("structure", ""),
        "explanation": item.get("explanation", ""),
        "examples": item.get("examples", []),
        "comparisons": item.get("comparisons", []),
        "quizzes": item.get("quizzes") or make_quiz(item),
    }
    for ex in out["examples"]:
        ex.setdefault("reading", "")
        ex.setdefault("notes", [])
    return out


def main() -> None:
    sources = sys.argv[1:]
    if not sources:
        sources = (
            sorted(glob.glob("/tmp/n5_grammar.json"))
            + sorted(glob.glob("/tmp/n5_part*.json"))
            + sorted(glob.glob("/tmp/n3_*.json"))
        )
    existing, tail = load_existing()
    by_id: dict[str, dict] = {it["id"]: it for it in existing}

    added = 0
    for src in sources:
        for raw in json.loads(Path(src).read_text(encoding="utf-8")):
            item = normalize(raw)
            if item["id"] not in by_id:
                added += 1
            by_id[item["id"]] = item

    merged = sorted(
        by_id.values(),
        key=lambda it: (LEVEL_ORDER.get(it["level"], 9), it["id"]),
    )

    # 写 grammar.ts
    ts = 'import { GrammarPoint } from "../types/grammar";\n\n'
    ts += f'export const grammarDatasetVersion = "{DATASET_VERSION}";\n\n'
    ts += "export const grammarPoints: GrammarPoint[] = "
    ts += json.dumps(merged, ensure_ascii=False, indent=2)
    ts += ";\n"
    ts += tail  # 原样保留 presetComparisons 等其它导出
    GRAMMAR_TS.write_text(ts, encoding="utf-8")

    # 写 seed_grammar.py
    seed_points = []
    for it in merged:
        ex = it["examples"][0] if it["examples"] else {"japanese": "", "chinese": ""}
        seed_points.append({
            "pattern": it["title"],
            "prompt": it["title"],
            "meaning": it["meaning"],
            "formation": it.get("structure") or it["title"],
            "example_jp": ex.get("japanese", ""),
            "example_meaning": ex.get("chinese", ""),
            "notes": it.get("explanation", ""),
            "confusions": "；".join(it.get("comparisons", [])),
            "level": it["level"],
            "importance": 3,
        })
    py = "# Generated from PDF N1-N5文法 (japanvitta.com) — N3/N4/N5 sections.\n"
    py += f"GRAMMAR_DATASET_VERSION = '{DATASET_VERSION}'\n\n"
    py += "GRAMMAR_POINTS = "
    py += json.dumps(seed_points, ensure_ascii=False, indent=2)
    py += "\n"
    SEED_PY.write_text(py, encoding="utf-8")

    counts: dict[str, int] = {}
    for it in merged:
        counts[it["level"]] = counts.get(it["level"], 0) + 1
    print(f"合并完成：新增 {added} 条，总计 {len(merged)} 条")
    print("各级别数量：" + ", ".join(f"{k}={counts[k]}" for k in sorted(counts)))


if __name__ == "__main__":
    main()
