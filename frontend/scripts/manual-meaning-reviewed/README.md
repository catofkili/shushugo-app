# 释义覆盖表的审校源头（2026-11-05，C1）

`frontend/src/data/jlpt_meaning_overrides.json` 是生成文件，只能由
`frontend/scripts/build-manual-meaning-overrides.mjs` 写入。本目录补回过去直接改生成文件、
没有回写源头的记录。C1 只恢复可重建性，不重新审校、不修改当前释义；历史记录中即使有
已知争议也原样保留，留给独立内容任务处理。

## 文件、数量与出处

| 文件 | 条数 | 来源和用途 |
| --- | ---: | --- |
| `2026-09-11-audit.json` | 485 | 09-11 全库审校及 09-19 复核后的最终状态。逐条带处理清单行号、词条 ID、实际落入 Git 的提交 `7ec8d30dadd9768b9446373c6231abde27fab3b5`。日期是审校来源日期，不冒称该提交发生在 09-11。 |
| `2026-09-22-prefix-review.json` | 3 | milli / nano / kilo 的后续复核，实际改动提交 `c89338609fa0a2f60ddabd9646502dcbdfe5c3f1`。清单里的原建议有误，以该提交中的最终释义为准，不能照建议重新覆盖。 |
| `distinction-source.json` | 1,559 | 由 `question-meaning-review/sync-distinction-meanings.mjs` 从全部 `manual-batch-*.json` 的 `classification=distinction` 条目导出。每条带批次文件、词形和历史同步提交 `7ec8d30dadd9768b9446373c6231abde27fab3b5`。不要手改此文件。 |
| `legacy-append-order.json` | 398 | 只有词形，没有释义。保存旧表末尾的 397 条历史补入和 09-28 追加的 `受験`，其追加提交为 `32b44357bdd7cadcb719904eaa3916e94d1e2e72`。只为保留逐字节相同的排版，绝不决定释义。 |

这些数量不是新的审校正确率：旧生成器的 6,253 条与基准 6,650 条相比，缺 397 条、
改变 1,264 条，合计 1,661 个不同词形。其中 1,173 个由现有辨析批次完整还原，
另外 488 个由本目录的两份人工记录还原（485 + 3）。辨析导出保留完整 1,559 条，
包括本来就和旧生成器相同的 386 条，避免未来同步时又绕开唯一生成入口。

历史审校中的错误回退也属于必须保存的最终状态。`docs/audits/2026-09-15-vocabulary-fixes.md`
头部列出的 76 条退回说明仍有效；本目录的 `reference` 是追溯线索，不代表重新批准该清单的
每一句建议。逐条的 `commit` 指向该释义最后一次变更的 Git 提交，而不是凭审校日期猜的提交。
这两份人工文件均以 `git log -- frontend/src/data/jlpt_meaning_overrides.json` 的逐版本值变化核对过。
辨析导出的 `commit` 则标记历史同步的来源提交，当前批次文件始终是可编辑的实际源头。

## 合并优先级

后者覆盖前者，同一 `(kanji, kana)` 最后写入的记录获胜：

1. `manual-meaning-rewrite/batch-*/meanings.json`，沿用既有 ID 链式去重映射和合并来源选择规则。
2. `manual-meaning-polish/batch-*.json`，沿用既有不得覆盖 rewrite 词形的检查。
3. `manual-meaning-polish/corrections.json`。
4. 本目录 `distinction-source.json`。
5. 本目录其余释义 `.json` 文件，按文件名升序；文件名较后的修订获胜。

`legacy-append-order.json` 不属于第 5 层。每个审校文件内部不许出现重复词形，
每条必须有非空释义及 `provenance.kind`、`provenance.reference`；能追溯提交时填完整的
40 位 `provenance.commit`，新的未提交审校允许暂不填提交号，不要伪造历史。
基础人工重写的 5,163 条数量检查、旧来源 ID/词形检查、合并成环检查均保留。

旧表前 6,252 条按固定 `en` locale 排序，末尾 398 条按独立顺序文件排列。
`受験` 在旧人工源头中已经是当前释义，只因 09-28 修订时移到表尾而需要单独保留顺序。
新词默认进入排序部分，无须维护一份全表顺序清单。不要从待校验覆盖表读取顺序或释义，
否则别人直接改产物也能影响重建结果，断言就失去意义。

## 以后怎么改释义

普通完整释义修订：在本目录新增按日期命名的人工 `.json` 文件，每条写
`kanji`、`kana`、`meaning`、`provenance`，留下审校判断依据和记录位置。若修订的是
辨析题面，先改 `question-meaning-review/manual-batch-*.json`，然后执行：

```sh
node question-meaning-review/sync-distinction-meanings.mjs
node frontend/scripts/build-manual-meaning-overrides.mjs
cd frontend && npm test
```

只改普通完整释义时无需先跑辨析导出；完整生成器仍会验证辨析输入没有过期。
第 5 层可有意覆盖辨析层，但必须在审校记录说明为什么两层不再相同，不能无意制造题面和答案冲突。
不要手改覆盖表或 `distinction-source.json`，不要为修复校验直接更新生成文件来掩盖缺失源头。

真实内容变更仍需按内容发布流程处理版本戳、seed/出厂库、双端共享包和 Taro 报告；
C1 没有内容变更，所以不升版、不重烤数据库。

## 断言与基准

`node frontend/scripts/build-manual-meaning-overrides.mjs --check` 在内存中完成相同生成，
用 `Buffer.equals` 逐字节比较仓库里的覆盖表，失败退出非 0，整个检查过程不写产物。
导入辨析导出函数后还会比较已提交的辨析源头和当前批次，漏跑导出也会失败。
`frontend/package.json` 的 `npm test` 先跑此断言，再跑原 Vitest；
`scripts/ci-local.sh` 和 `.github/workflows/ci.yml` 的 frontend job 都执行 `npm test`，
GitHub runner 不需要个人基准文件、未跟踪文件或 Git 历史即可重建。
`frontend/scripts/build-manual-meaning-overrides.test.mjs` 用临时 checkout 做回归：先在没有产物时
独立重建并比较全部字节，再手改一条释义，确认 `--check` 失败且没有偷偷覆盖手改文件；
最后改辨析批次，确认旧导出会被拒绝、同步只更新源头记录而不更新覆盖表。
测试对真实工作树只读，临时改过的释义和批次在结束后删除。
`scripts/package-preview.sh` 同步补进旧人工源头目录、辨析批次和导出脚本，保证打包后的
`npm test` 不因这些新的直接依赖缺失而失败。

C1 基准是 `500251f073de5928baa461a723cd1c904cc08a69` 的覆盖表：653,377 字节，
SHA-256 `534b68c4ea6fb919e94d593b91fdfd41ed94f9d06f798b86d8d9abcdb95b90d0`。
工作树外的持久备份位于
`/Users/lsc/Library/Application Support/codex-with-chatgpt/_meaning-baseline/2026-11-05-C1-500251f0/jlpt_meaning_overrides.json`。
选用此位置是因为本会话可写范围不包含 `~/Documents/shushugo-wt/_meaning-baseline/`；
备份不在 `/tmp`，也没有改主目录工作区。
