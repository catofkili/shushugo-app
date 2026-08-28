#!/usr/bin/env python3
"""
「词难度轴有没有预测力」的一次性评测 —— docs/VOCAB_SIZE_ESTIMATE.md 的结论就是这个脚本跑出来的。

结论是**否定的**（三个特征都没达到门槛），所以这个脚本的价值全在可复算上：
以后谁想重开这个功能，先把下面四个输入凑齐、跑一遍，看看数字有没有变。

用法（在 frontend/ 下）：
    python3 scripts/analysis/vocab-axis-eval.py \
        --db .local/frozen-2026-08-25.db \
        --jmdict .local/JMdict_e.gz \
        --vdrj .local/VDRJ_Ver1_0_Teachers_Top60894.xlsx \
        --jkvc .local/JKVC_ver3_0.xlsx

四个输入都**不在仓库里**，各自的来路和许可：

  db      个人学习库的冻结快照。`.local/live.db` 是活的（dev server 每 20 秒改写），
          必须先 cp 出一份定死的再算，否则每次跑的数都不一样。
          本文档引用的那份 sha256 = 3f655fc867a1fc3ef446999128ce22406191d44cd5444df6b1f2c1fc4b50f52e
  jmdict  http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz  · EDRDG, CC BY-SA 4.0
          本文档引用的那份 sha256 = fed341a919a537f74c769bc5c69a18c8f5b7fcf372c25b0bef07e69dc35a15d0
  vdrj    https://www.tatsumatsushita.com/database/VDRJ_Ver1_0_Teachers_Top60894.xlsx
          松下達彦「日本語を読むための語彙データベース」· ⚠️ 页面未声明使用条款，
          仅供离线评估；要用进产品必须先取得作者授权。
          sha256 = 22dde654b967dde38ce93c0532a7b5d730a4d7b2c16b7b840a4aa89008500173
  jkvc    https://www.tatsumatsushita.com/database/JKVC_ver3_0.xlsx
          松下達彦ほか「日中対照漢字語データベース」· 同上，研究引用格式见其页面。
          sha256 = b85a31006256949e8f89c5a477ec1d8546f444a7b31442c4fc82bea3c6154045

口径（改这里就等于换了一次实验，改完要在文档里说明）：
  * 「首答」= 每个 word_id 在 direction='forward' 里按
    (reviewed_on, created_at, COALESCE(reviewed_at,0), id) 排序的第一条。
    **不能用 MIN(id)** —— id 是本地自增，跨设备同步后和时间不同序（实测差 50 个词）。
  * 「会」= answer IN ('know','known_forever')；fuzzy 不算。
  * VDRJ 只接受表记+读音精确匹配；纯假名词允许以假名同时作为表记和读音匹配，
    不接受只有读音相同的回退。JKVC 只接受汉字表记+读音精确匹配，不把同音异形词算进去。
  * 分层 AUC 只在 N5/N4/N3/N2 上合并（N1 正例太少），层内两两配对后按对数加总，
    即以「层内可比较对数」为权重。
  * bootstrap：对整个样本有放回重抽，B=2000，seed 固定。
"""
import argparse, collections, math, random, re, sqlite3, sys, xml.etree.ElementTree as ET, zipfile
from zlib import decompress

BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 20260825
STRAT_LEVELS = ("N5", "N4", "N3", "N2")

# ── 最小 xlsx 读取（只用到共享字符串 + 单元格值） ────────────────────────────
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

def sheet_rows(path, sheet_name):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rid = {s.get("name"): s.get(f"{RS}id") for s in wb.iter(f"{NS}sheet")}[sheet_name]
    target = {r.get("Id"): r.get("Target")
              for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}[rid]
    if not target.startswith("xl/"):
        target = "xl/" + target.lstrip("/")
    col = lambda ref: sum((ord(c) - 64) * 26 ** i
                          for i, c in enumerate(reversed([c for c in ref if c.isalpha()]))) - 1
    for row in ET.fromstring(z.read(target)).iter(f"{NS}row"):
        cells = {}
        for c in row.iter(f"{NS}c"):
            v, t = c.find(f"{NS}v"), c.get("t")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{NS}t"))
            elif v is None:
                val = ""
            elif t == "s":
                val = shared[int(v.text)]
            else:
                val = v.text
            cells[col(c.get("r"))] = val
        yield [cells.get(i, "") for i in range(max(cells) + 1)] if cells else []

# ── 通用工具 ────────────────────────────────────────────────────────────────
clean = lambda s: re.sub(r"\s+", "", re.sub(r"\[[^\]]*\]", "", s or ""))
kata2hira = lambda s: "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)
is_loan = lambda k, r: bool(re.search(r"[A-Za-z]", k or "")) and bool(re.search(r"[゠-ヿ]", r or ""))

def auc(rows, score):
    """越大越「该会」。带并列的 Mann-Whitney U。"""
    pos = [score(d) for d in rows if d["y"]]
    neg = [score(d) for d in rows if not d["y"]]
    if not pos or not neg:
        return None
    n = sum(1 if a > b else 0.5 if a == b else 0 for a in pos for b in neg)
    return n / (len(pos) * len(neg))

def stratified_auc(rows, score):
    """层内两两配对合并；权重 = 层内可比较对数。"""
    num = den = 0
    for lv in STRAT_LEVELS:
        s = [d for d in rows if d["lv"] == lv]
        pos = [score(d) for d in s if d["y"]]
        neg = [score(d) for d in s if not d["y"]]
        for a in pos:
            for b in neg:
                num += 1 if a > b else 0.5 if a == b else 0
                den += 1
    return num / den if den else None

def boot_ci(rows, score):
    rng = random.Random(BOOTSTRAP_SEED)
    vals = []
    for _ in range(BOOTSTRAP_B):
        s = [rows[rng.randrange(len(rows))] for _ in rows]
        v = stratified_auc(s, score)
        if v is not None:
            vals.append(v)
    vals.sort()
    return vals[int(len(vals) * 0.025)], vals[int(len(vals) * 0.975)]

def report(name, rows, score):
    pt = stratified_auc(rows, score)
    lo, hi = boot_ci(rows, score)
    print(f"  {name:34s} n={len(rows):5d}  全样本 AUC={auc(rows, score):.4f}   "
          f"等级内分层 AUC={pt:.4f}  95% CI [{lo:.4f}, {hi:.4f}]")
    return pt

# ── 数据源 ──────────────────────────────────────────────────────────────────
def first_answers(db_path):
    con = sqlite3.connect(db_path)
    q = """WITH r AS (SELECT word_id, answer, ROW_NUMBER() OVER (PARTITION BY word_id
             ORDER BY reviewed_on, created_at, COALESCE(reviewed_at,0), id) rn
           FROM reviews WHERE direction='forward')
         SELECT w.kanji, w.kana, w.jlpt_level, r.answer
         FROM r JOIN words w ON w.id = r.word_id WHERE r.rn = 1"""
    out = []
    for k, kana, lv, ans in con.execute(q):
        out.append({"kanji": clean(k), "kana": clean(kana), "raw_kanji": k or "", "raw_kana": kana or "",
                    "lv": lv or "(无级)", "y": 1 if ans in ("know", "known_forever") else 0, "ans": ans})
    con.close()
    return out

def jmdict_index(path):
    xml = decompress(open(path, "rb").read(), 16 + 15).decode("utf-8")
    def collect(block, tag):
        out, o, c, i = [], f"<{tag}>", f"</{tag}>", 0
        while True:
            a = block.find(o, i)
            if a < 0: return out
            b = block.find(c, a)
            if b < 0: return out
            out.append(block[a + len(o):b]); i = b + len(c)
    idx = {}
    for raw in xml.split("<entry>")[1:]:
        block = raw.split("</entry>", 1)[0]
        ks = [(collect(e, "keb") or [""])[0] for e in collect(block, "k_ele")]
        kp = [collect(e, "ke_pri") for e in collect(block, "k_ele")]
        for e in collect(block, "r_ele"):
            reb = (collect(e, "reb") or [""])[0]
            if not reb: continue
            pri = collect(e, "re_pri")
            restr = set(collect(e, "re_restr"))
            if not ks or "<re_nokanji" in e:
                idx.setdefault(f"{reb}|{reb}", set()).update(pri); continue
            for keb, kpri in zip(ks, kp):
                if not keb or (restr and keb not in restr): continue
                idx.setdefault(f"{keb}|{reb}", set()).update(kpri + pri)
    return idx

def jmdict_rank(tags):
    if not tags: return None
    nf = [int(m.group(1)) for m in (re.fullmatch(r"nf(\d+)", t) for t in tags) if m]
    if nf: return (min(nf) - 0.5) * 500
    if tags & {"ichi1", "news1", "spec1", "gai1"}: return 6000
    if tags & {"ichi2", "news2", "spec2", "gai2"}: return 15000
    return None

def vdrj_ranks(path):
    IS_RANK, LEX, ORTH, READ = 1, 13, 14, 15
    pair = {}
    for i, r in enumerate(sheet_rows(path, "重要度順語彙リスト60894語")):
        if i == 0 or len(r) <= READ: continue
        try: rank = int(float(r[IS_RANK]))
        except (TypeError, ValueError): continue
        read = kata2hira(str(r[READ] or "").strip())
        orth = str(r[ORTH] or "").strip() or str(r[LEX] or "").strip()
        if not read: continue
        pair.setdefault((orth, read), rank)
    return pair

def jkvc_correspondence(path):
    LEX, ORTH, READ, CORR = 2, 3, 5, 10
    pair, dist = {}, collections.Counter()
    for i, r in enumerate(sheet_rows(path, "上位２万語、漢語のみ")):
        if i == 0 or len(r) <= CORR: continue
        corr = str(r[CORR] or "").strip()
        if not corr: continue
        dist[corr] += 1
        read = kata2hira(str(r[READ] or "").strip())
        orth = str(r[ORTH] or "").strip() or str(r[LEX] or "").strip()
        if orth and read:
            pair.setdefault((orth, read), corr)
    return pair, dist

# ── 主流程 ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    for a in ("db", "jmdict", "vdrj", "jkvc"): ap.add_argument(f"--{a}", required=True)
    args = ap.parse_args()

    rows = first_answers(args.db)
    print(f"冻结快照 {args.db}")
    print(f"首答样本 {len(rows)} 条，其中「会」{sum(d['y'] for d in rows)} 条 "
          f"（{sum(d['y'] for d in rows)/len(rows)*100:.1f}%）\n")

    print("按等级（Wilson 95% CI）：")
    for lv in ("N5", "N4", "N3", "N2", "N1"):
        s = [d for d in rows if d["lv"] == lv]
        if not s: continue
        k, n = sum(d["y"] for d in s), len(s)
        p, z = k / n, 1.96
        den = 1 + z * z / n
        c = (p + z * z / (2 * n)) / den
        h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
        fz = sum(1 for d in s if d["ans"] == "fuzzy")
        print(f"  {lv}  n={n:4d}  会={k:4d}  fuzzy={fz:3d}  {p*100:5.1f}%  "
              f"[{max(0,c-h)*100:.1f}, {min(1,c+h)*100:.1f}]")

    LVR = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1, "(无级)": 3}
    print(f"\n只用 JLPT 等级（先验序 N5>N4>N3>N2>N1）：全样本 AUC={auc(rows, lambda d: LVR[d['lv']]):.4f}")
    print("  （等级轴没有「等级内」可言，所以它只有全样本 AUC，不能和下面的分层 AUC 直接比大小）\n")

    print("三个候选难度轴：")
    idx = jmdict_index(args.jmdict)
    jm = []
    for d in rows:
        surface = d["kana"] if is_loan(d["raw_kanji"], d["raw_kana"]) else (d["kanji"] or d["kana"])
        rank = jmdict_rank(idx.get(f"{surface}|{d['kana']}"))
        if rank: jm.append({**d, "s": -math.log(rank)})
    report("JMdict nf 词频", jm, lambda d: d["s"])

    vp = vdrj_ranks(args.vdrj)
    vd = []
    for d in rows:
        surface = d["kana"] if is_loan(d["raw_kanji"], d["raw_kana"]) else (d["kanji"] or d["kana"])
        rank = vp.get((surface, d["kana"])) or vp.get((d["kana"], d["kana"]))
        if rank: vd.append({**d, "s": -math.log(rank)})
    report("VDRJ 留学生用词汇排名", vd, lambda d: d["s"])

    jp, dist = jkvc_correspondence(args.jkvc)
    jk = []
    for d in rows:
        corr = jp.get((d["kanji"], d["kana"]))
        if corr: jk.append({**d, "s": 1 if corr == "＝" else 0, "corr": corr})
    report("JKVC 日中同形同义（＝ vs 其余）", jk, lambda d: d["s"])
    print(f"\n  JKVC 意味対応分布：{dict(dist.most_common(8))}")
    g = collections.defaultdict(lambda: [0, 0])
    for d in jk:
        g[(d["lv"], d["corr"] == "＝")][0] += 1
        g[(d["lv"], d["corr"] == "＝")][1] += d["y"]
    print("  按等级 × 是否同义的首见就会率：")
    for lv in ("N5", "N4", "N3"):
        cells = []
        for same in (True, False):
            n, k = g[(lv, same)]
            cells.append(f"{'同义' if same else '非同义'} {k/n*100:5.1f}%(n={n:3d})" if n else "—")
        print(f"    {lv}  " + "   ".join(cells))

if __name__ == "__main__":
    main()
