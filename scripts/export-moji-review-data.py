#!/usr/bin/env python3
"""Export a logged-in MOJi user's review state to a portable JSON file.

The script reads MOJi's local URL cache only to reuse the user's existing
signed-in session. It never writes to MOJi's container and it deliberately
does not copy authentication tokens into the export. Network access happens
only with --fetch: MOJi is queried for the user's review states and the word
details required by Master Nihongo's existing word-list importer.

Usage (macOS):
  1. Open MOJi, enter the vocabulary review screen once, then quit MOJi.
  2. python3 scripts/export-moji-review-data.py --fetch
  3. AirDrop the generated JSON to an iPhone and import it in Master Nihongo.

This relies on MOJi's current private client API and may need maintenance when
MOJi changes its cache format or endpoints. It does not bypass login: the user
must already be signed in to their own account in MOJi on that Mac.
"""

from __future__ import annotations

import argparse
import gzip
import json
import plistlib
import sqlite3
import sys
import time
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MOJI_CACHE_TABLE = "cfurl_cache_blob_data"
# MOJi has used both endpoints across app versions. `test/reviews` is the
# current one observed in MOJi 8.36, while `teststates-list` is retained for
# older caches.
REVIEW_ENDPOINTS = ("teststates-list", "/test/reviews")
DETAIL_ENDPOINT = "https://api.mojidict.com/app/mojidict/api/v1/word/detailInfo"
DEFAULT_OUTPUT = Path.home() / "Desktop" / "master-nihongo-moji-review-export.json"
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_REALM_HELPER = SCRIPT_DIR / "moji-realm-export" / "export-words.cjs"


def iter_cache_paths(home: Path) -> Iterable[Path]:
    roots = [home / "Library" / "Containers", home / "Library" / "Group Containers"]
    for root in roots:
        if not root.exists():
            continue
        yield from root.glob("**/Data/Library/Caches/**/Cache.db")


def has_moji_review_request(cache_path: Path) -> bool:
    try:
        with sqlite3.connect(f"file:{cache_path}?mode=ro", uri=True) as connection:
            rows = connection.execute(
                f"SELECT request_object FROM {MOJI_CACHE_TABLE}"
            )
            return any(
                marker.encode() in bytes(row[0])
                for row in rows
                for marker in REVIEW_ENDPOINTS
            )
    except sqlite3.DatabaseError:
        return False


def find_cache(explicit_path: Path | None) -> Path:
    if explicit_path:
        if not explicit_path.is_file():
            raise RuntimeError(f"找不到指定的 MOJi 缓存：{explicit_path}")
        return explicit_path
    candidates = [path for path in iter_cache_paths(Path.home()) if has_moji_review_request(path)]
    if not candidates:
        raise RuntimeError(
            "没有找到包含背词复习记录的 MOJi 缓存。请在这台 Mac 的 MOJi 中登录，打开一次“背词/复习”页面后再运行。"
        )
    return max(candidates, key=lambda path: path.stat().st_mtime)


def find_realm(explicit_path: Path | None) -> Path:
    if explicit_path:
        if not explicit_path.is_file():
            raise RuntimeError(f"找不到指定的 MOJi 临时词库：{explicit_path}")
        return explicit_path
    candidates = list((Path.home() / "Library" / "Containers").glob("**/Data/tmp/core-mojidict-sc*.backup.realm"))
    if not candidates:
        raise RuntimeError("没有找到 MOJi 的临时词库；请先在 MOJi 中打开背词复习页。")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def walk_values(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_values(child)


def decode_cached_request(raw: bytes) -> tuple[str, dict[str, str], dict[str, Any]]:
    payload = plistlib.loads(raw)
    values = list(walk_values(payload))
    urls = [item["_CFURLString"] for item in values if isinstance(item, dict) and isinstance(item.get("_CFURLString"), str)]
    headers = next(
        (
            {str(key): str(value) for key, value in item.items()}
            for item in values
            if isinstance(item, dict) and any(str(key).lower() in {"x-parse-session-token", "x-moji-token"} for key in item)
        ),
        {},
    )
    bodies: list[dict[str, Any]] = []
    for item in values:
        if not isinstance(item, bytes):
            continue
        try:
            decoded = json.loads(item.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(decoded, dict):
            bodies.append(decoded)
    if not urls or not headers or not bodies:
        raise RuntimeError("MOJi 缓存格式无法识别；请更新桥接脚本。")
    return urls[0], headers, bodies[0]


def cached_request_for(cache_path: Path, markers: Iterable[str]) -> tuple[str, dict[str, str], dict[str, Any]]:
    marker_list = tuple(markers)
    with sqlite3.connect(f"file:{cache_path}?mode=ro", uri=True) as connection:
        rows = connection.execute(
            f"SELECT request_object FROM {MOJI_CACHE_TABLE} ORDER BY entry_ID DESC"
        )
        for (raw,) in rows:
            if not any(marker.encode() in bytes(raw) for marker in marker_list):
                continue
            url, headers, body = decode_cached_request(bytes(raw))
            if any(marker in url for marker in marker_list):
                return url, headers, body
    raise RuntimeError("缓存中没有找到背词复习请求。请先在 MOJi 中打开背词复习页。")


def common_headers(cache_path: Path) -> dict[str, str]:
    """Get MOJi app headers needed by the word-detail endpoint without exposing them."""
    with sqlite3.connect(f"file:{cache_path}?mode=ro", uri=True) as connection:
        rows = connection.execute(
            f"SELECT request_object FROM {MOJI_CACHE_TABLE} ORDER BY entry_ID DESC"
        )
        for (raw,) in rows:
            try:
                _, headers, _ = decode_cached_request(bytes(raw))
            except (RuntimeError, ValueError, plistlib.InvalidFileException):
                continue
            if any(key.lower() == "x-moji-token" for key in headers):
                return headers
    return {}


def safe_headers(headers: dict[str, str]) -> dict[str, str]:
    blocked = {"content-length", "accept-encoding", "__hhaa__", "host"}
    return {key: value for key, value in headers.items() if key.lower() not in blocked}


def request_json(url: str, headers: dict[str, str], body: dict[str, Any] | None = None) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=safe_headers(headers), method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"MOJi 请求失败（HTTP {error.code}）。请重新登录 MOJi 后重试。") from error
    return json.loads(raw.decode("utf-8"))


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("result", "data", "docs"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
            if isinstance(value, dict):
                rows = extract_rows(value)
                if rows:
                    return rows
    return []


def fetch_review_states(url: str, headers: dict[str, str], body: dict[str, Any]) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    page = 1
    while True:
        request_body = dict(body)
        request_body.update({"page": page, "limit": 200})
        rows = extract_rows(request_json(url, headers, request_body))
        all_rows.extend(rows)
        if len(rows) < request_body["limit"]:
            return all_rows
        page += 1
        time.sleep(0.2)


def read_realm_words(realm_path: Path, helper_path: Path) -> dict[str, dict[str, Any]]:
    if not helper_path.is_file():
        raise RuntimeError(f"找不到 Realm 读取器：{helper_path}")
    environment = dict(os.environ)
    extra_modules = environment.get("MOJI_REALM_NODE_PATH", "")
    if extra_modules:
        environment["NODE_PATH"] = extra_modules + (":" + environment["NODE_PATH"] if environment.get("NODE_PATH") else "")
    try:
        result = subprocess.run(
            ["node", str(helper_path), str(realm_path)],
            check=True, capture_output=True, text=True, env=environment, timeout=45
        )
        rows = json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise RuntimeError(
            "无法读取 MOJi 临时词库。首次使用请运行："
            "npm install --prefix scripts/moji-realm-export"
        ) from error
    return {str(row.get("objectId")): row for row in rows if isinstance(row, dict) and row.get("objectId")}


def export_rows(states: list[dict[str, Any]], words_by_id: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    exported: list[dict[str, Any]] = []
    failed: list[str] = []
    unique_states = {str(row.get("targetId")): row for row in states if row.get("targetId")}
    for index, (word_id, state) in enumerate(unique_states.items(), start=1):
        word = words_by_id.get(word_id)
        if not word or not word.get("spell"):
            failed.append(word_id)
            continue
        exported.append({
            "spell": word.get("spell"),
            "pron": word.get("pron") or word.get("spell"),
            "briefInfo": word.get("briefInfo") or word.get("excerpt") or "",
            "excerpt": word.get("excerpt") or "",
            "tags": word.get("tags") or "",
            "score": state.get("score", 0),
            "qCnt": state.get("qCnt", 0),
            "qWrCnt": state.get("qWrCnt", 0),
            "testTimes": state.get("testTimes", 0),
            "updatedAt": state.get("updatedAt") or "",
            "source": "moji-review-export"
        })
        if index % 25 == 0:
            print(f"已读取 {index}/{len(unique_states)} 条 MOJi 复习记录…", flush=True)
        time.sleep(0.08)
    return exported, failed


def main() -> int:
    parser = argparse.ArgumentParser(description="导出 MOJi 背词复习记录为 Master Nihongo 可导入 JSON")
    parser.add_argument("--cache", type=Path, help="可选：手动指定 MOJi Cache.db")
    parser.add_argument("--realm", type=Path, help="可选：手动指定 MOJi 临时 Realm 词库")
    parser.add_argument("--realm-helper", type=Path, default=DEFAULT_REALM_HELPER, help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fetch", action="store_true", help="向已登录的 MOJi 账号发起只读请求并生成导出文件")
    args = parser.parse_args()

    cache_path = find_cache(args.cache)
    print(f"已找到 MOJi 复习缓存：{cache_path}")
    if not args.fetch:
        print("缓存检查通过。加上 --fetch 后才会访问 MOJi 并生成导出文件。")
        return 0

    review_url, review_headers, review_body = cached_request_for(cache_path, REVIEW_ENDPOINTS)
    states = fetch_review_states(review_url, review_headers, review_body)
    if not states:
        raise RuntimeError("MOJi 返回了 0 条复习记录；请确认当前账号确实有背词记录。")
    realm_path = find_realm(args.realm)
    words_by_id = read_realm_words(realm_path, args.realm_helper)
    rows, failed_ids = export_rows(states, words_by_id)
    output = {
        "format": "master-nihongo-moji-review-export-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "records": rows,
        "skippedMojiWordIds": failed_ids
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成 {len(rows)} 条可导入记录：{args.output}")
    if failed_ids:
        print(f"另有 {len(failed_ids)} 条未能读取词义，已跳过。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(f"导出失败：{error}", file=sys.stderr)
        raise SystemExit(1)
