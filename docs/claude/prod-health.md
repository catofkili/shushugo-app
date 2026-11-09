# 每日线上体检与客户端失败上报

## 用途与现状（2026-11-09）

事故暴露的是“已有信号，没有人主动看”：活跃账号没有云备份、用户反馈重装后进度消失，
都可能早于真正的数据丢失。`scripts/prod-health.sh` 把这些信号集中成一次只读体检，
供每天定时启动的 Claude 会话执行、读输出，有 WARN/FAIL 才深挖和通知作者。
脚本本身不安装定时任务、不发送通知、不修复或删除数据。

原 `scripts/sync-health.sh` 及上一轮的快照保留改动保持原状。它的总账号、微信账号、
有快照账号统计，以及“活跃却没有新备份”的 SQL 判据已并入新脚本的“云备份”项；
日常只运行 `prod-health.sh` 即可，无需再运行旧脚本、另开一次 SSH。

**客户端新 kind 尚未接通。** 迁移 `0017_feedback_reports.sql` 的 CHECK 约束只允许
`feedback / error / hang / crash`。仅改 TypeScript 白名单，线上 INSERT 仍会失败；
必须另做数据库迁移。用户本次明确要求“需要数据库迁移就停下报告”，因此本次没有修改
服务器接收白名单、旧迁移、前端或小程序，也没有用旧 kind 或 diagnostics 偷渡新类别。
失败计数查询已经准备好，但现阶段的 0 **不能证明没有客户端失败**。

## 手动运行与依赖

在有 SSH 私钥的作者电脑、仓库根目录执行：

```bash
bash scripts/prod-health.sh
```

本机需要 Bash、OpenSSH、curl、Python 3（仅标准库）及常见 Unix 工具；不需要本机安装
SQLite 才能运行线上体检，SQLite 仅在服务器执行。自测另外需要本机 sqlite3 和 Python sqlite3。
SSH 固定为 `~/.ssh/shushugo_server`、`admin@8.148.68.155`，无交互认证，连接超时 10 秒，
使用已知主机密钥且不自动更新 known_hosts。尚未建立主机信任时，由作者先自行核对并配置。

一次 SSH 完成五项数据库查询及日志、timer、文件、磁盘检查；数据库使用
`sudo -n sqlite3 -bail -readonly -batch`，五项查询共用一个只读事务，等待数据库锁最多 5 秒。
没有上传、远端临时文件、数据库复制、PRAGMA 修复、迁移、重启或 timer 触发。
`/api/health` 从作者电脑另发一次 GET，连接超时 10 秒、总超时 20 秒。

每项一行 `OK|WARN|FAIL 项目名 — 一句话`；异常明细缩进，每项最多 20 行。
账号与反馈明细是 JSON，换行和控制字符会转义，反馈正文只取前 200 个字符。
付款明细不输出验单原文、JWS、OpenID、联系信息。体检输出供作者私下处理，不要贴到公开仓库。

退出码：全 OK 为 **0**，存在 WARN 为 **1**，存在 FAIL 为 **2**；最后一行始终为
`SUMMARY ok=N warn=N fail=N`。备份任务与备份文件各占一行，另检查 scheduled timer，
所以正常完整运行共 11 项，状态文件异常会增加一项。SSH 失败仍会检查 HTTP 健康接口。
调用方不能使用 `脚本 || true` 丢掉退出码；没有新 kind 的上报能力也不能从全 OK 推断出来。

每日 Claude 会话应读取退出码及完整输出：0 时保持安静；1/2 时按下表先排查、再通知作者。
运行日志要保留至该次排查结束，尤其是反馈超过 20 条时，游标不会因为只展示 20 条而停留。
不要并行启动多份体检；脚本只有一个反馈游标，没有并发任务锁。

## 检查项、阈值与第一排查位置

| 项目 | 预防的故障与判据 | WARN/FAIL 后先看哪里 |
| --- | --- | --- |
| 云备份 | 最近 14 天登录过，却从无 `sync_objects`，或最新快照比最后登录早超过 3 天：WARN。14 天覆盖近期使用者，3 天容忍短期离线但不能让备份长期缺席；恰好落后 3 天不报，恰好 14 天仍计入。总账号/微信账号/有快照账号沿用旧脚本口径。 | 先按账号对照 `users.last_login`、`sync_objects` 和 `sync_heads`；空 head 不算备份。再查客户端同步生命周期、登录后的第一次拉取及上传失败。参见同步专题 11-05 事故记录。 |
| 新反馈 | 比上次成功扫描更新的任何反馈：WARN；首次只回看 3 天，避免旧反馈淹没首次体检。明细包含时间、kind、platform、版本、message 前 200 字，最多 20 条；计数是全部新增数量。 | 先读该条反馈上下文和版本；反馈多于 20 条时，用同一游标区间只读查询余下条目。不要把用户描述直接当作已确认根因。 |
| 付款 | 服务器已确认付款且应仍有效，却没有有效付费权益，或正式永久权益变成限时权益：FAIL。相同原始交易已退款/撤销却仍提供有效 Pro：FAIL。缺少可读到期/环境证据时 WARN，要求人工核对。 | 按 `user_id` 和原始交易号对照 `wechat_orders`、`purchase_events`、`entitlements`；Apple 再看 `apple_notifications`，检查 scheduled 重查是否失败。先确认是否到期、沙盒或另买了更强权益，再考虑补发或撤权；脚本不执行这些写操作。 |
| 快照骤缩 | 每个账号按 generation、时间、id 取最新和前一份；前一份 > 50 KiB（51,200 B）、最新不足前份的一半：WARN。排除小存档的自然波动，盯住空库/残库覆盖；恰好 50% 不报。 | 先核对两代 `byte_length`、压缩及格式是否改变，再只读检查对象与快照完整性；保护每日历史，停止可疑客户端继续覆盖应由作者决定。体积是实际上传字节数，不是解压后大小，正常裁剪/格式变化也可能触发。 |
| 服务器报错 | `shushugo-worker.service` 最近 24 小时中，匹配 5xx 数字、error 或 exception 的行数 > 0：WARN；每行只计一次。数字和 URL 归一后列前 5 组；journal 读不了为 FAIL。零阈值是为了让单人维护者看到首次异常。 | 先用同一 journalctl 命令看原行和前后文，再按路由、错误类别核对；这是日志文本启发式，不是 HTTP 错误率，也不能发现根本没被记录的响应。 |
| 备份任务 | `shushugo-worker-backup.timer` 非 active，或其 service 上次 Result 非 success/退出码非 0：FAIL。未留本次开机运行时间、上次启动距今 > 36h 或在未来超过 5min：WARN。正常 oneshot 服务 inactive 不算失败。 | `systemctl show/status shushugo-worker-backup.timer shushugo-worker-backup.service`，再看备份 service 的 journal。不要运行 backup.sh 来“验证”，它会写线上库备份。 |
| 备份文件 | `/var/lib/shushugo/backups/worker-*.sqlite` 最新 mtime 超过 36h、未来超过 5min、缺失或大小为 0：FAIL。每天一次备份，36h 给排程/短暂停机留 12h 余量，同时能及时发现漏跑。 | 对照 `cloudflare-sync/selfhost/backup.sh`、目录权限、空间及最新文件时间。文件新且非空不等于可恢复；脚本不做还原演练。SQLite 备份不包含 R2 对象，异机对象备份仍需单独解决。 |
| 定时任务 | 同样检查 `shushugo-worker-scheduled.timer/service`。timer/result 失败为 FAIL，运行时间不明或 >36h 为 WARN，防止 Apple 重查和反馈 180 天清理静默停摆。 | scheduled service 的 journal，及 `src/index.ts` 的 scheduled handler；本脚本不触发任务。 |
| 磁盘 | `df -P /var/lib/shushugo` 使用率 > 80%：WARN，恰好 80% 不报；读不了或无法解析为 FAIL。为 SQLite/WAL、14 份备份、R2 日常增长与发布暂存留空间。 | 先只读看数据目录、backups、r2 与日志占用，估算增长率；不自动清文件，也不把 40 GB 全当作快照预算。 |
| `/api/health` | HTTP 非 200 或连接失败：FAIL。此处只验证可达性与状态码。 | 先区分本机网络、DNS/TLS、Caddy 和 worker 服务，再看 health JSON 的 `productionReady`、配置与迁移布尔量；HTTP 200 不证明这些字段全为 true。 |
| 客户端失败 | 最近 24h 按四种新 kind 汇总，>0 为 WARN，每 kind 一行；0 时也明确提醒新 kind 尚未接通。 | 先确认迁移、服务器白名单和客户端发布均完成，再按类别、版本、平台排查。未同意自动发送的设备、离线设备、未发布新版本都不会提供完整样本；不能推算全体设备的真实失败率。 |

所有数据库日期比较用 `julianday` 或 UTC epoch，兼容 ISO 的 T、Z、偏移和小数秒。
这些检查只确认当前服务器里可读的元数据，不能证明对象正文存在、学习内容完整、所有付款均被服务器知晓，
也不能从未收到退款事件推断支付平台没有退款。

### 付款证据为何要单独解析

已核对当前服务器代码：微信 `wechat_orders.status` 的已付款状态是 `paid / delivered`，退款为
`refunded`；微信查询响应 `order.status=2` 才算付款。Apple 成功验单写
`purchase_events.status=verified`，撤销写 `revoked`；当前订阅状态 2/3 不再有效，5 为撤销。
`unpaid / rejected / missing_apple_config / owned_by_other_account` 都不是付款成功证据。

查询保留每个账号、原始交易链最后一条有效验单/撤销状态；同一时间优先撤销。
退款仅检查当前权益仍归该原始交易的账号，避免“退掉旧单，另买新单”被误报。
更强的有效付费权益可以覆盖旧单，试用不算付费权益已落地；正常到期不报警。

Apple `raw_payload` 是含 JWS 的原始 API 响应，不能当作已有 `expiresDate` 的平铺 JSON。
SQL 只选需核对的候选，再在本机用 Python 标准库解开已入库的正文；支持单笔交易和订阅状态响应，
宽限期读取 renewal JWS 的 `gracePeriodExpiresDate`。这是读取服务器此前已验证的审计证据，
没有重新验证签名或调用支付平台，不能冒充实时支付核验。
微信期限按北京时间自然月、月末夹紧，并接上首发赠送截止日；沙盒按验单记录起最多 30 天核对。
验单事件唯一键会使同笔重复核验不刷新旧事件时间，因此旧沙盒证据可能不足以还原后来延长的宽限；
沙盒到期不当正式漏发。证据损坏/缺失的候选出 WARN，不能给它编造到期日。

## `~/.shushugo-health-state`

唯一持久写入是作者本机这一个文件，内容为十进制 UTC epoch 秒，代表**上次完整收到并成功解析的
SQL 扫描开始时间**，不是服务器上的学习数据。首次不存在时，从服务器当前时间前 3 天开始。
脚本以服务器开跑时间作为本次截止，反馈查询区间为 `[上次游标, 本次截止)`：
本次截止那一秒的条目留到下次，避免整数秒边界漏报。

只有 SSH 正常结束、完整结束标记收到、全部 SQL 成功且付款解析可用才推进游标。
磁盘、timer、HTTP 等独立检查有异常仍可推进，因为该批反馈已经展示；异常本身会在下次持续检查。
SSH/SQL/解析失败时保留旧游标。状态不可读/格式无效/晚于服务器时间则 FAIL，回看最近 3 天但
不覆盖原状态，交由作者核对。写入权限为新文件 0600（umask 077），已有文件不主动改权限。
没有另建状态库、锁文件或远端文件。单文件直接写入若中断留下空内容，下次会明确 FAIL，不会静默跳过反馈。

要重看某段反馈，由作者在没有并行体检时，把游标设为该段起点的 epoch 秒；删除该文件会重回
“只看最近 3 天”，**不会**自动重放更老的反馈。超过 20 条的结果必须在作者排查中按输出计数补查，
不能以展示上限代替总量。长事务若在扫描后才提交且带更早的 created_at，仍可能越过时间游标；
它不是数据库提交序号，也不是通知投递的 exactly-once 保证。

## 客户端失败 kind 与隐私边界

隐私内容唯一源为 `frontend/src/lib/privacy-policy-content.ts`；当前
`PRIVACY_POLICY_VERSION=2026-09-27`，展示生效日期为 2026 年 10 月 13 日。
“意见反馈与诊断信息”已经列明版本、平台、当前页面、错误信息、有效登录令牌识别账号、
IP 哈希限流与 180 天保留，并明确：

> 错误报告只有在你确认发送或开启自动发送后才会上报。

已读 `feedback-runtime-core.ts`：`hang` 在默认关闭自动发送时发出候选报告，由用户确认；
只有 `getAutoSendErrors()` 为 true 才自动提交。新类别若后续获准实施，必须遵守同一边界。
**现有政策不覆盖默认无同意的静默自动上传**；如果产品要求改成默认自动，先修订上面这句话，
说明自动错误类别、最小字段、触发条件、关闭方式及既有 180 天保留，然后按协议版本规范取得同意；
不能因为本次只统计次数就跳过同意。

| 新 kind（本次均未接通） | 计划的触发点 | 排除与隐私要求 |
| --- | --- | --- |
| `persist-fail` | `storage.ts` 的 `notifyPersistenceError` | 只记写盘错误类别；不包含数据库字节、SQL 绑定值、词条或本机备份正文。写盘失败时上报去重也不能依赖“写入必成功”。 |
| `archive-unreadable` | `LocalArchiveUnreadableError` | 只记打不开这一类别；不提交 `rawData`、恢复文件、数据库内容或底层可能含学习内容的 cause。原有重试/导出/确认重建路径必须保留。 |
| `sync-fail` | 自动同步的最终 error | 排除断网、429、409 以及会自动重试的本机 revision 变化；不要把学习内容、请求体、快照或账号令牌塞进 error message。 |
| `login-fail` | 微信登录失败（平台凭证获取及服务端交换） | 不收集 code、session_key、OpenID、UnionID、邮箱、用户输入或微信响应原文。用户主动取消不当故障。 |

后续实施标准：每台设备、每种 kind、每天最多 1 次；仅固定错误类别及经过审查的安全 message
前 200 字，外加 platform、app_version、route，不带学习内容、单词、便签、用户输入或设备唯一标识。
不要直接截断任意原始 Error 来假装脱敏。新增服务器白名单/输入裁剪和客户端同意/去重/载荷测试，
再生成共享层、构建 Taro 并守住 1,900,000 B 主包闸门；超限按本次要求停止报告，不扩大预算。
网页和小程序必须使用同一份逻辑。本次未修改这些客户端路径，既有 hang 的行为保持原样。

## 自测与作者部署顺序

```bash
bash -n scripts/prod-health.sh
bash scripts/prod-health.selftest.sh
cd cloudflare-sync && npm run check && npm test
```

自测按 `cloudflare-sync/migrations/*.sql` 顺序建临时 SQLite，分别验证空库、构造异常及阈值边界。
所有 SSH/HTTP/系统命令均用替身；生产库与真实游标不参与。自测先断言新 kind 被原 CHECK 拒绝，
仅在临时夹具连接使用 `ignore_check_constraints` 插入四种未来类别来验证预备聚合 SQL，
**生产脚本没有这个 PRAGMA，不能照搬到线上**。另覆盖退出码、单次 SSH、反馈秒边界、SQL/SSH
失败不推进游标、磁盘/备份边界、timer 失败、日志归并和 20 行明细上限。有 shellcheck 就运行，
没有则明确 SKIP；不能把自测称作线上验证。

自测的输出断言使用系统 `grep`，不依赖 `rg`。2026-11-09 退回复修已复现：缺少 `rg`
时，即使体检打印正确的 SUMMARY，断言也会误报 Missing；可用
`PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash scripts/prod-health.selftest.sh` 复验无 `rg` 环境
（这些路径中需有本机的 Python 3 和 sqlite3），完整 SQL、集成断言仍须通过。

1. A 仅需让每日 Claude 会话在这个 checkout 的可访问副本运行脚本，配置已核对的 SSH 访问，
   首次手动看完整输出，再安排每天调用；不需要为 A 部署 Worker 或改生产库。
2. 上一轮快照保留改动如尚未部署，按同步专题和 `cloudflare-sync/selfhost/README.md`
   另行完成 selfhost 构建与发布、重启服务及授权测试账号核对；脚本存在不代表保留策略已上线。
3. B 必须先得到新增数据库迁移的授权，另做 CHECK 表重建迁移及数据保留测试，服务器允许新 kind
   后才可发布客户端。不得改已应用的 0017、不得开启 `ignore_check_constraints`、不得仅改 TS 后强行发布。
   当前隐私只允许确认/主动开启自动发送；默认静默模式还需先修订政策并取得同意。
4. 本次没有 Git 写命令、部署、生产写操作、前端生成/构建或学习页刷新；客户端新 kind 的数量为 0
   仍属于“尚无观测能力”，不能作为 B 的上线验收。
