# JLPT 固定搭配候选：选词与分级说明

## 产物边界

- `frontend/scripts/jlpt-collocation-manual-review.json` 是全量人工决定源，`pending` 必须为 0。
- `frontend/src/data/jlpt_collocation_candidates.json` 是由脚本生成的独立候选产物。
- 这批数据没有接入运行时，也没有中文释义或例句。后续释义、例句、人工复核和许可展示完成前，不应写入发布数据库。
- N5–N1 是面向中国学习者的教学分级，不代表 JLPT 官方词表。

## 来源与许可证

主候选源为 EDRDG 的 **JMdict English XML Next Generation**，快照创建日为 2026-08-28：

- 下载地址：<https://www.edrdg.org/pub/Nihongo/JMdict_e_NG.gz>
- SHA-256：`a669ef152c50b2ab94f4cea80598e3982e1dca10df65b73bb8dc5d6cef384467`
- 许可证：CC BY-SA 4.0
- EDRDG 许可与署名要求：<https://www.edrdg.org/edrdg/licence.html>

JMdict 提供候选表记、读音、稳定 `ent_seq`、词类和常用标记。清单没有复制英文释义；`selection_reason` 是本项目对“为什么值得作为独立学习单位”的原创审核记录。筛选时没有使用 MOJi、商业教材或来源不明的 JLPT 词表。

## 收录口径

每条必须至少符合一种情况：

1. 名词、助词和谓语之间有明显选择限制；
2. 整体义或语用功能不能稳定地由组成词逐字推出；
3. 属于需要整句调用的寒暄、敬语或场景表达；
4. 属于现代语境仍有实际辨识价值的谚语或四字熟语。

排除自由组合、孤立普通词、仅仅是活用后的语法片段、古语、方言、低俗语、专门领域表达和过冷表达。同一 JMdict `ent_seq` 的异写只保留一个现代教学表记。

## 全量处理结果

- JMdict 初始候选池：15,302 条；
- 与当前 `frontend/public/nihongo.db` 表记＋读音匹配而排除：190 个 JMdict 条目；
- 当前种子库 phrase-like 基线：93 条（其中含普通词、语法片段和异写重复，未直接照单扩充）；
- 最终接受：1,200 条；待定：0 条；
- 等级：N5 20、N4 80、N3 200、N2 400、N1 500；
- 类型：collocation 300、idiom 740、routine_expression 60、proverb 30、yojijukugo 70。

低阶合计仍为 300 条。现有种子库已覆盖许多最基础寒暄，因此新增清单只保留 20 条 N5，避免为了配额把正式敬语或抽象表达错误地下放。N2/N1 数量较大，是因为需要整块识别的抽象搭配、惯用语和书面表达主要集中在中高阶。

## 重建与验证

```bash
cd frontend
node scripts/build-jlpt-collocation-candidates.mjs
node scripts/verify-jlpt-collocation-candidates.mjs
```

验证会检查总量、等级与类型分布、`pending=0`、`ent_seq` 唯一、规范化表记＋读音唯一、与干净种子库无直接碰撞、来源许可证，以及不存在中文释义/例句字段。脚本明确只读取 `public/nihongo.db`，拒绝真实学习数据库路径。
