# W1 Taro 冷启动试验记录

日期：2026-09-26  
分支：`taro/w1-startup`  
正式构建代码提交：`d8df8de`  
本报告和开发者工具截图在后续提交中补入。

## 改动

1. `ensureUserTables()` 和 `ensureSyncSchema()` 把运行时实际 DDL / 触发器 SQL 算成指纹，分别存入 `app_state` 的 `runtime_schema_user_ddl`、`runtime_schema_sync_ddl`。两个键均列入 `DEVICE_LOCAL_STATE_KEYS`，导出和合并都会过滤；指纹随数据库文件保存，导入另一个库后会按该库自己的标记判断是否需要重跑。
2. `sync_uid` 和 `sync_origin_device` 仍每次启动检查。先用已建索引的 `SELECT 1 … IS NULL LIMIT 1` 探测，发现缺值才回填。新增 47 个局部索引，合计净增 208,896 B。
3. Taro 内容加载器按页面声明等待内容，再 prime 网页 loader；`readyForKanji()` 只预载汉字页首屏需要的三份内容。失败的内容加载 promise 会清除，允许重试。8 份出厂内容仍使用经过产物路径校验的 `require.async`。
4. 首次下载先尝试 gzip 文件，读取下载进度并用微信 `FileSystemManager.readCompressedFile` 解压；失败时回退原始 `.db`。gzip 目标路径由现有 `.db` URL 派生为 `.db.gz`，当前无需改线上配置。

## 结构迁移计时

使用 `frontend/public/nihongo.db` 的只读副本，Node + sql.js，3 次冷启动和 3 次已登记结构启动；没有读取或写入 `frontend/.local/live.db`。

| 项目 | 结果 |
| --- | ---: |
| 出厂库 | 11,567,104 B |
| 结构迁移后 | 12,722,176 B |
| 迁移净增 | 1,155,072 B |
| 冷启动 SQL 数中位数 | 773 条 |
| 冷启动总时长中位数 | 116.404 ms |
| `ensureUserTables()` 中位数 | 10.249 ms |
| `ensureSyncSchema()` 中位数 | 105.526 ms |
| 已登记结构启动 SQL 数中位数 | 101 条 |
| 已登记结构启动总时长中位数 | 4.330 ms |
| `sync_origin_device` 局部索引 | 47 个，净增 208,896 B |

本轮可复核命令：`cd frontend && npm test -- src/lib/startup-schema-metrics.test.ts --reporter=verbose --silent=false`。结果 1 个文件、1 项测试通过；计时值是 Node/sql.js 副本测量，不代表 iPhone 耗时。

## 开发者工具运行

使用已分配的 9421 自动化端口和 24 词测试夹具。当前本地库路径 `USER_DATA_PATH/masternihongo/nihongo.db` 为 15,740,928 B；上一代 `.prev` 为 15,736,832 B。屏幕计时浮层只收集到 1 次样本，不能当作稳定分位数：

| 阶段 | 样本数 | 中位数 / p90 |
| --- | ---: | ---: |
| 首页可交互 | 1 | 121 / 121 ms |
| 读库文件 | 1 | 3 / 3 ms |
| 下载库文件 | 0 | 未测（已有本地库） |
| `openAndValidate` | 1 | 22 / 22 ms |
| `ensureStudySchema` | 1 | 146 / 146 ms |
| 内容分包 `require.async` | 1 | 814 / 814 ms |

WordStudy 操作已走通：首卡「安心」→ 翻面显示例句「連絡が取れたので、家族も安心しました。」→ 点「认识」进入下一张（显示“答案已隐藏”）→ 点撤销回到前卡。截图使用 macOS 对指定模拟器窗口捕获，未调用会触发 `saveFile` 错误的 Automator 截图接口，也没有清理 IDE 文件或关闭 IDE：

- [翻面前](devtools-word-study-front.png)
- [翻面后](devtools-word-study-back.png)
- [评分后的下一张](devtools-word-study-next.png)
- [撤销后](devtools-word-study-undo.png)

模拟器期间收到一条开发者工具日志错误：`log writeFile err writeFile:fail the maximum size of the file storage limit is exceeded`。它的完整前缀是开发者工具的日志写入告警；本轮自动化没有捕获到应用层 `Failed to save database`，本地数据库和 `.prev` 均可按文件系统 API 读取大小。没有清理或改写开发者工具的日志目录。Automator 的 `mini.screenshot()` 也报过 `saveFile:fail exceeded the maximum size of the file storage limit`，所以报告截图改用系统窗口捕获。

## 首次下载压缩测量

| 格式 | 字节数 | 相对原库节省 | Node 解压耗时 |
| --- | ---: | ---: | ---: |
| 原始 SQLite | 11,567,104 B | — | — |
| gzip level 9 | 2,211,484 B | 9,355,620 B（80.88%） | 31.676 ms |
| Brotli q6 | 1,611,349 B | 9,955,755 B（86.07%） | 9.567 ms |

gzip 产物：`/private/tmp/shushugo-w1-startup/nihongo.db.gz`，SHA-256：`18fc8fca08f929f2b76b8988f0743d422f0ebed63441d58bbe0beb17a6a6382e`。gzip 与 Brotli 的 Node 往返校验均通过。Taro 运行时选用微信原生 gzip 解压 API；真实 iPhone 解压时间尚未测得。

## 正式构建包体

阈值表同时保留微信 2 MiB 限制和本项目 1,900,000 B 内部闸门。数据取自同次正式构建生成的 `package-sizes.json`、`webpack-stats.json`。

| 包 | 字节数 |
| --- | ---: |
| 主包 | 1,878,549 B |
| quiz | 75,789 B |
| study | 381,858 B |
| features | 661,703 B |
| content | 1,619,451 B |
| grammar-foundation | 668,448 B |
| grammar-advanced | 547,372 B |
| grammar-pages | 240,486 B |
| **合计** | **6,073,656 B** |

8 个包均通过 1,900,000 B 闸门；主包距内部闸门 21,451 B。核心重复模块 0 B，页面组件重复 66,902 B / 100,000 B 上限，webpack 产物中 `shared/web.js` 为 0 个模块。正式构建包含 20 个 webpack 入口。

## 检查结果

| 命令 | 结果 |
| --- | --- |
| `frontend: npm run check` | 通过 |
| `frontend: npm test` | 113 个文件；801 项通过，26 项跳过 |
| `frontend: npm run lint` | 0 errors，33 条既有 warnings |
| `wechat-miniprogram: npm run build-shared && npm run build-data && npm test` | 30 个检查脚本通过 |
| `taro-spike-2: npm test` | 通过；10 个异步目标路径和包体闸门通过 |
| `taro-spike-2: npm run build:weapp` | 通过；20 个入口；主包和分包均过闸门 |

**Taro 预览包用的是 profiling 版 React，比正式版慢，所以 Taro 的计时数字是上限。**

## 待用户上传后继续

没有上传云存储、没有上传版本或提审，也没有生成预览码。开发者工具已有本地库，所以本轮没有真实测到 gzip 下载、首次建库或 iPhone 解压。请在 CLI 已登录 `tcb` 的终端执行下列命令，将文件上传到由运行时自动派生的 `seed/nihongo.db.gz`：

```sh
cd /private/tmp/shushugo-w1s/wechat-miniprogram
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
ENV_ID=$(node -p "require('./cloudbaserc.json').envId")
tcb storage upload /private/tmp/shushugo-w1-startup/nihongo.db.gz seed/nihongo.db.gz --times 3 -e "$ENV_ID" < /dev/null
```

上传后把 CLI 的成功输出和云文件路径发回。我再生成仅供扫码的 W1 计时预览码，测压缩库下载 / 解压 / 导入各阶段，并留出 iPhone 冷启动测量；真机计时需要每阶段至少 20 次后才报告中位数和 p90。
