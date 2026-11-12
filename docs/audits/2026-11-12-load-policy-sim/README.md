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

## 第二轮：只降上限与会原谅的闸

继续使用同一个 `common.mjs` 和 `simulator.mjs`，没有另建模拟模型。第二轮固定普通新词0，供给为 `ordinaryN3`，不投放未见搭配；保留已学搭配的复习。起点、180天、五个种子1000至1004、主场景与封顶79%的定义均沿用第一轮。

从 worktree 根目录逐条运行；不用重跑第一轮报告生成或复制命令：

```sh
node docs/audits/2026-11-12-load-policy-sim/r2-check.mjs
node docs/audits/2026-11-12-load-policy-sim/r2-calibrate.mjs
node docs/audits/2026-11-12-load-policy-sim/r2-grid.mjs
node docs/audits/2026-11-12-load-policy-sim/r2-report.mjs
cp frontend/.local/load-sim/policy-results/report-r2.md docs/audits/2026-11-12-load-policy-sim-r2.md
node docs/audits/2026-11-12-load-policy-sim/r2-verify.mjs
```

`r2-grid.mjs` 按要求生成48个组合，再各跑两个场景和五个种子，共96个场景配置、480条轨迹：P0与P1a各跑五种闸和150/200/300/全出；P1b与新增P3a只跑现行闸、F1和200/300。P3a为拟合参数、目标0.70、上线重算。第一轮 `grid.mjs scan` 仍只扫描原来的五种排期，不混入P3a。

第二轮的 `config()` 新增可选 `gate` 字段，取 `L0`、`L8/10`、`F1`、`F2`、`F3`；不提供时沿用第一轮的 `leech`/`intake` 行为与标签。`gates.mjs` 维护历史首答与原谅状态：

- 只收同一个词在较晚学习日的首答；首次真实学习、同日补答都不收。历史与未来同用这个口径。
- F1达到累计8次后，两个连续跨日首答正确才能放出；放出后累计再有两次跨日“忘了”才回池，不要求两次遗忘连续。模糊打断连对但不充作“忘了”。历史中已经发生的原谅与再次遗忘也重建，不把上线日当作空历史。
- F2只看最近至多10次跨日首答，至少5次“忘了”才入池。历史不足10次不补样本，不按比例放大。
- 现行闸、F1、F2先从到期池中词随机取至多10个，再跟普通到期词一起受总首答上限截取。10个不是保底配额。
- F3没有池；优先在普通到期词里随机填名额，剩余名额再从累计8次以上的到期词中随机取。L0/F3的池子数是0，另存累计8次词数，不能把“无池”解释为“无遗漏”。

`r2-grid.mjs` 逐配置写入私有检查点 `policy-results/grid-r2.json`，内有聚合的五种子指标和逐日池子范围。模型脚本、冻结库及权重的哈希不同会拒绝复用；确实要从头重跑时使用：

```sh
node docs/audits/2026-11-12-load-policy-sim/r2-grid.mjs --reset
```

它只覆盖本轮私有检查点。`r2-calibrate.mjs`、`r2-report.mjs`、`r2-verify.mjs` 分别写 `calibration-r2.json`、`report-r2.md`、`verification-r2.json`；第一轮的网格、标定JSON和报告均不覆盖。兼容性验收运行第一轮 `verify.mjs` 时，会更新其私有校验清单 `verification.json`。公开报告只复制到新的 `2026-11-12-load-policy-sim-r2.md`。不要把第二轮报告复制回第一轮文件。

第四轮标定的唯一口径修正：在第三轮已使用的历史参与比例之前，先读当天实际排出的复习任务数，以 `min(515, 当天已排复习数)` 为复习上限；每天新学仍25，目标仍387首答、847作答、39%遗忘，误差闸门仍15%。结果388.3首答、912.3作答、42.9%遗忘，相对偏差+0.3%/+7.7%/+10.1%，原三项闸门通过。参与比例与目标来自同一窗口，**没有完成独立标定**；没有再拟合记忆倍率、压低每次耗时，未来轨迹也没有乘历史减量系数。上面的第一轮失败记录仍保留原义。

等时间表以第15至180天的日均分钟中位数分成五个互斥档，每个场景各列第180天与考试日预计想起词数前五名；第三张仅列档位或档内名次发生变化的组合，使用全部组合的名次。宽时间档不代表实际耗时相等；报告另列真实耗时、前14天与峰值，并用耗时接近的组合补充配对。所有词数差值均按相同种子相减后取中位数，种子最小最大不是置信区间。

`r2-check.mjs` 检查跨日原谅、两次再忘、滚动窗口、每日池内名额和F3优先级；`r2-verify.mjs` 核对96个配置及480套指标、固定库存、计时和概率恒等式、封顶阈值、八条轨迹重跑、已发表排行榜和完整组合覆盖、五个报告标题、语法、无假名、第一轮报告未改与Git改动范围。第一轮 `verify.mjs` 仍可运行，比较原有指标以确认新增选项未改变旧轨迹。
