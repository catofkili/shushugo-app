# 2026-11-12 作者负荷模拟

这是离线分析脚本，复用已给的 `fsrs-fit/load.mjs` 的真实记忆模型、官方调度器、历史同日序列池和随机数发生器。没有应用改动，不执行任何 git 写命令，不访问网络或学习网页。

## 输入与依赖

在 worktree 根目录运行，Node 24。以下输入都留在私有的 `frontend/.local/load-sim/`，不能提交：

- `live-frozen.db`：只读 SQLite 冻结库。
- `fsrs-fit/{load.mjs,cards.json,params.json,fit.json}`：已给估算器与拟合产物。
- `fsrs-fit/node_modules/ts-fsrs` 和官方原生绑定：已备齐，不安装。
- `reports/2026-11-03-fsrs-fit.md`、`reports/2026-11-03-fsrs-retention-check.md`：原调查依据。

诊断辨析成员时，使用已安装的 `frontend/node_modules/esbuild`，它可能只读指向主目录。不会在主目录创建缓存、构建文件或其他文件。脚本用只读数据库适配器执行真实分组代码；生成的临时模块和所有结果只写 `frontend/.local/load-sim/policy-results/`。

## 重跑

以下每条命令分别执行；不需要启动任何服务器：

```sh
node docs/audits/2026-11-12-load-policy-sim/preflight.mjs
node docs/audits/2026-11-12-load-policy-sim/calibrate.mjs
node docs/audits/2026-11-12-load-policy-sim/diagnose.mjs
node docs/audits/2026-11-12-load-policy-sim/grid.mjs scan
node docs/audits/2026-11-12-load-policy-sim/grid.mjs combine
node docs/audits/2026-11-12-load-policy-sim/shortlist.mjs
node docs/audits/2026-11-12-load-policy-sim/grid.mjs caps
node docs/audits/2026-11-12-load-policy-sim/grid.mjs actual
node docs/audits/2026-11-12-load-policy-sim/report.mjs
```

原估算器的摘要固定读取第34天，因此依赖试跑必须至少34天；本脚本按原规格跑60天、1种子、全部21个场景，不把“2天试跑越界”误判成依赖缺失。原文件不改，依赖路径修正只发生在私有脚本副本里。

`grid.mjs` 逐配置落盘并支持续跑。若修改了模型、输入、种子或参数，应先只删除私有结果 `policy-results/grid.json` 再从 `scan` 重跑；不要沿用旧检查点。检查点不是应用状态，不包含原始词条或逐卡流水。`shortlist.mjs` 明确记录加跑上限的三个候选，不依赖手工创建的外部文件。

`report.mjs` 生成的报告先在私有目录。检查后只把最终报告复制到唯一授权的公开位置，再验收：

```sh
cp frontend/.local/load-sim/policy-results/report.md docs/audits/2026-11-12-load-policy-sim.md
node docs/audits/2026-11-12-load-policy-sim/verify.mjs
```

输出报告较长，因为保留228个组合的完整中位数与最小最大；正文先呈现关键表，完整网格折叠在方案部分。

## 模型与证据边界

- `common.mjs`：只读数据、状态重建、官方 FSRS 模型和调度器，以及与 `repeat()` 等价性检查。
- `simulator.mjs`：从11-10状态推进180天；同日必须完成学习/重学步骤，累计遗忘闸与同日错3次升级三步分别处理；153个先验身份整卡不进入新词和回炉序列池。
- `calibrate.mjs`：从09-30流水状态重建，28个实际学习日回放，最多三轮；最后一行打印标定结果。
- `grid.mjs`：25个单维度配置、16个组合、12个上限配置，各自乘两种供给和两种真实记忆；另8个实际普通词库存配置乘两种真实记忆。每配置固定5个种子1000至1004。
- `diagnose.mjs`：只有聚合统计；不导出原始词性标签、词条、辨析键或词标识清单。词性原标签可能含文字内容，因此公开报告保留中文大类和匿名细格。
- `report.mjs`：完整指标、时间换算、同供给同场景的配对差值和局限；只写私有目录。
- `verify.mjs`：核对输入哈希、600次调度等价检查、五种子覆盖、供给和上限约束、关键轨迹可重现、报告结构、隐私及改动范围。

本次最后结果为 `CALIBRATION FAIL`：每天首答词数高估15.6%，作答数高估17.2%。所有模拟结论都必须保留“未标定”，不能删去失败后再引用方案数值。SQL诊断不依赖模拟器是否通过标定。

封顶79%的场景里，真实可提取率达到80%的词数必为0；报告另给平均概率和预计能想起的词数。不能把未封顶的潜在R直接当成该场景的实际记住词数。

冻结库与背景供给不同：N3以内普通新词为0，未见的157个都是独立配额的固定搭配。主网格包含搭配作为宽口径供给实验，另外单列符合普通新词资格的实际库存场景。不要将两种口径混用。新学的具体词面、优先顺序与独立搭配日额没有完整模拟。

## 隐私与工作区约束

公开目录只保留脚本、README和聚合报告。数据库、原始导出、生成模块、网格JSON、逐日池子曲线、校验清单均留在 gitignore 私有目录。没有平假名或片假名字符；检测用的正则只写 Unicode 转义。

不读取真实浏览器状态，不访问5173，不联网，不装依赖，不写主目录，也不调用应用数据初始化或落盘。提交和合并由主会话处理，本脚本不执行。
