# ShuShuGo Worker 自托管

W25 把 `cloudflare-sync/src/index.ts` 用 Wrangler 原样打包，再由 Node 22 调用同一个 `fetch` / `scheduled` 入口。路由和业务 SQL 没有重写。当前部署只监听 `127.0.0.1:8787`，供服务器本机和以后启用的反向代理访问；本轮不启用公网 HTTP/HTTPS、不改 DNS、不切换 Cloudflare 流量。

## 当前服务

| 项目 | 值 |
|---|---|
| 主机 | `8.148.68.155`，Ubuntu 24.04 x86_64 |
| Node | Node.js `v22.23.3` LTS 官方 Linux 二进制；最低要求 22.16.0，使用官方 `SHASUMS256.txt` 校验 |
| Worker 目录 | `/opt/shushugo/cloudflare-sync/` |
| 数据目录 | `/var/lib/shushugo/`，目录权限 `0700` |
| 凭据 | `/etc/shushugo/worker.env`，`root:root 0600`；systemd 以 credential 只读交给服务 |
| HTTP | `127.0.0.1:8787`，不监听公网网卡 |
| 主服务 | `shushugo-worker.service` |
| 原 cron | `shushugo-worker-scheduled.timer`，每天 03:17 UTC |
| SQLite 备份 | `shushugo-worker-backup.timer`，每天 03:25 UTC；`/var/lib/shushugo/backups/`，保留 14 天 |
| 反代 | `Caddyfile.pending` 仅为待启用配置；Caddy 未安装/启用；本机当前没有 80/443 listener |

systemd 服务以专用 `shushugo` 用户运行，失败自动重启，日志写 journald。SQLite 主文件和备份为 `0600`；R2 对象与元数据保存在数据目录。SQLite WAL/SHM 是运行时文件，不要在服务运行时手工复制数据库文件。

## Node 兼容性

选 `node:sqlite` 是为了避免原生 addon 和额外运行依赖。Node 22.13 起不再需要 `--experimental-sqlite` 开关；`DatabaseSync` 仍标记为实验 API。这里要求 Node 22.16+，因为适配层使用了 `statement.columns()` 和 `statement.setReturnArrays()`。上线二进制应从 [Node 官方下载页](https://nodejs.org/download/release/)获取，并用同目录 `SHASUMS256.txt` 校验；版本升级要重跑本 README 的构建、路由测试和本机检查。

Worker 用到的运行时能力：

| Worker API | Node 自托管实现 |
|---|---|
| `crypto.subtle`、`crypto.getRandomValues`、`crypto.randomUUID`、`fetch`、`FormData`、`Request` / `Response` | Node 22 的 Web API 全局对象 |
| `env.DB` | `node:sqlite` D1 适配层：`prepare/bind/first/all/run/raw`，`batch` 在一个 SQLite 事务内顺序执行；返回 `{results, success, meta}` 形状 |
| `env.SYNC_BUCKET` | 本地 R2 适配层，覆盖 Worker 实际调用的 `put/get/head/delete/list`；对象放在 `r2/`，ETag、HTTP metadata、custom metadata 放在 `.metadata/` |
| `env.SYNC_DATA` | SQLite KV 表，支持当前用到的 `get/put/delete` 和 TTL/绝对过期时间 |
| 三个 `RateLimiter` binding | SQLite 固定 60 秒窗口，保留各自的 2/4/20 次阈值；限速键只存 SHA-256 摘要 |
| `ctx.waitUntil()` | HTTP 响应完成前等待所有注册任务；失败写入 journald |
| `scheduled()` | systemd 每天 03:17 UTC 启动 Worker 原有 scheduled handler |

源码没有用 `caches`、`HTMLRewriter`、`request.cf` 或 `scheduler.wait`，所以没有为它们加模拟层。客户端 IP 由反代写入 `CF-Connecting-IP`；待启用的 Caddy 配置会覆盖该请求头。应用层 IP 限速在公网反代启用后才有真实客户端地址。

适配层语义测试会覆盖 D1 事务回滚、R2 条件创建、KV 过期、Worker 健康/认证/同步路由及 `waitUntil`。它是本代码当前使用范围的兼容测试，不代表 Cloudflare 全套 D1/R2/KV API。

## 构建与本机运行

在独立 checkout 中执行；以下测试已纳入 `npm test`：

```sh
cd cloudflare-sync
npm ci
npm test
npm run check
```

只构建 Worker bundle：

```sh
npm run selfhost:build
```

本地试跑用单独数据目录，不碰主应用或学习页：

```sh
SHUSHUGO_DATA_DIR=/tmp/shushugo-selfhost-data node selfhost/server.mjs
curl -sS -w '\nHTTP %{http_code} total=%{time_total}s\n' http://127.0.0.1:8787/api/health
curl -sS -w '\nHTTP %{http_code} total=%{time_total}s\n' http://127.0.0.1:8787/api/auth/config
```

无密钥启动时，`/api/health` 仍返回 200 以供本机诊断，但 `productionReady` 为 `false`；认证强化开启且 Turnstile/邮件未配置时，认证路由按 Worker 原逻辑返回 503。`/api/auth/config` 只报告开关状态，不返回密钥。

## 初始部署步骤

主机安装的系统包只有 `ca-certificates`、`curl`、`sqlite3`；Node 使用 Node.js 官方发布的 x86_64 tarball，不加第三方 apt 源。以 v22.23.3 为例，先下载并核对官方 checksum，再解压到 `/opt`：

```sh
NODE_VERSION=v22.23.3
curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
grep " node-$NODE_VERSION-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum --check
sudo tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C /opt
sudo ln -sfn "/opt/node-$NODE_VERSION-linux-x64/bin/node" /usr/bin/node
node --version
```

在本地 checkout 构建后，只打包 Worker bundle、适配层和迁移文件，不把 `node_modules` 或密钥放进部署包：

```sh
cd cloudflare-sync
npm ci && npm test && npm run check && npm run selfhost:build
cd ..
tar -czf /tmp/shushugo-w25.tar.gz cloudflare-sync/selfhost cloudflare-sync/migrations
scp /tmp/shushugo-w25.tar.gz admin@8.148.68.155:/tmp/
ssh admin@8.148.68.155 'sudo install -d -o root -g root -m 0755 /opt/shushugo && sudo tar -xzf /tmp/shushugo-w25.tar.gz -C /opt/shushugo --no-same-owner --no-same-permissions'
```

主机创建专用账户和空凭据文件：

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl sqlite3
getent passwd shushugo >/dev/null || sudo useradd --system --home-dir /var/lib/shushugo --create-home --shell /usr/sbin/nologin shushugo
sudo chown -R root:root /opt/shushugo/cloudflare-sync
sudo chmod 0755 /opt/shushugo/cloudflare-sync/selfhost/{backup.sh,install-migration.sh,set-secrets.sh}
sudo install -d -o root -g root -m 0700 /etc/shushugo
sudo install -o root -g root -m 0600 /dev/null /etc/shushugo/worker.env
```

将 `shushugo-worker.service`、`shushugo-worker-scheduled.service`、`shushugo-worker-scheduled.timer`、`shushugo-worker-backup.service`、`shushugo-worker-backup.timer` 安装到 `/etc/systemd/system/`，随后：

```sh
for unit in shushugo-worker.service shushugo-worker-scheduled.service shushugo-worker-scheduled.timer shushugo-worker-backup.service shushugo-worker-backup.timer; do
  sudo install -o root -g root -m 0644 "/opt/shushugo/cloudflare-sync/selfhost/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable --now shushugo-worker.service shushugo-worker-scheduled.timer shushugo-worker-backup.timer
```

不要安装/启用 `Caddyfile.pending`，也不要为本服务打开公网端口。当前服务只需本机 smoke 和 SSH 运维。

## 主机运维

```sh
sudo systemctl status shushugo-worker
sudo journalctl -u shushugo-worker -n 100 --no-pager
sudo journalctl -u shushugo-worker -f
systemctl list-timers 'shushugo-worker-*'
sudo /opt/shushugo/cloudflare-sync/selfhost/set-secrets.sh
sudo systemctl restart shushugo-worker
curl -sS -w '\nHTTP %{http_code} total=%{time_total}s\n' http://127.0.0.1:8787/api/health
curl -sS -w '\nHTTP %{http_code} total=%{time_total}s\n' http://127.0.0.1:8787/api/auth/config
```

`set-secrets.sh` 在终端逐项无回显地提示，空输入保留现值；输入 `CLEAR` 清空该项。私钥可输入包含字面量 `\n` 的单行 PEM，Worker 会还原换行。保存后重启服务使新凭据生效。

需要用户本人在主机输入的密钥及来源：

| 环境变量 | 来源/用途 |
|---|---|
| `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 对应站点的 Site Key / Secret Key；生产认证必填 |
| `RESEND_API_KEY`、`EMAIL_FROM` | Resend API Key 与已验证发件地址；生产认证必填 |
| `APP_STORE_ISSUER_ID`、`APP_STORE_KEY_ID`、`APP_STORE_PRIVATE_KEY` | App Store Connect API key 页面上的 Issuer ID、Key ID、下载的 `.p8`；Apple 交易验证用 |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET` | 微信小程序后台；小程序登录/内容安全和支付配置用 |
| `WECHAT_MOBILE_APP_ID`、`WECHAT_MOBILE_APP_SECRET` | 微信开放平台移动应用；微信移动端登录用，与小程序凭据不同 |
| `WECHAT_PAY_SANDBOX_APP_KEY` 或 `WECHAT_PAY_PRODUCTION_APP_KEY` | 微信小程序虚拟支付后台，填写与 `WECHAT_PAY_ENV` 对应的一项 |
| `WECHAT_MSG_TOKEN` | 微信小程序消息推送配置；微信支付通知校验用 |

`WECHAT_PAY_ENV` 默认是 `1`（沙箱）；在确认支付环境前不要填写/启用生产 AppKey。`APP_STORE_PRIVATE_KEY`、支付密钥等只由用户本人输入，不能放 Git、命令行参数或部署包中。`/api/health` 的 `productionReady` 只要求认证用 Turnstile、Resend 和 `REQUIRE_AUTH_HARDENING=1`；其它渠道会分别显示配置布尔值。

备份查看：

```sh
sudo ls -lh /var/lib/shushugo/backups
sudo journalctl -u shushugo-worker-backup.service -n 30 --no-pager
```

备份仅覆盖 SQLite；本任务没有配置 R2 对象的异机/周期备份。切流前需要为 `/var/lib/shushugo/r2/` 确定独立备份方案，并核对 40 GB 磁盘可容纳 SQLite 14 份备份、R2 数据和迁移暂存包。

## 数据迁移（当前未执行）

`migrate.mjs` 仅在显式运行时访问 Cloudflare；本轮没有调用远端 D1、R2 或 KV。切换日先阻断所有旧 Worker 写入并等待在途请求完成，再从本地 checkout 运行：

```sh
cd cloudflare-sync
export CLOUDFLARE_API_TOKEN='由操作者在本机安全注入'
export CLOUDFLARE_ACCOUNT_ID='Cloudflare Account ID'
node selfhost/migrate.mjs
```

脚本打印的归档位于本机独立 `0700` 临时目录中；保留该目录直到完成 SSH 传输，然后删除整个目录。token 通过本机安全环境注入，不要把真实值写进命令历史或文档。

迁移脚本执行 `wrangler d1 export --remote`，再用远端 D1 的只读查询逐表核对导出行数；分页列出 R2 对象并通过 `wrangler r2 object get --remote` 逐个下载；分页列出 KV key，以每批 10 个 key 读取文本值、metadata 返回的过期时间，并只导入尚未过期的值。建议 token 仅授予对应账户的 D1 Read、R2 Read、Workers KV Storage Read。若 Wrangler 导出所需的权限高于该只读模板，应先在 Cloudflare 权限页核对，不要直接改用 Global API Key。

归档内容含用户表、会话、团队、订单/权益、同步快照等数据，可能包含个人信息；脚本将归档权限设为 `0600`，请通过 SSH 传输、限制本机暂存目录权限并在验收后删除。远端 D1 行数、完整表名、SQLite integrity、迁移记录数和本地导入行数都会核对；任何差异都会停止生成/安装。

保留规则：

- **D1 全表保留**，包括 `sessions`、`auth_rate_limits`、支付/权益、团队和审计数据；不会因迁移重建身份或 entitlement。
- **所有仍有效的 KV 项保留**，含微信会话 `wechat-session:*`、登录失败计数、Apple replay 防重放项、`wechat-access-token`、头像 `profile-avatar:*` 及旧版同步快照；按原过期时间导入。过期项会丢弃。运行时只依赖其文本值，不依赖 KV metadata。
- **R2 全量保留**，包括用户同步快照与周报对象；保留对象 key、修改时间、ETag、HTTP/custom metadata。
- Cloudflare `RateLimiter` 是独立 binding，**无法导出其窗口计数**；自托管限速器从空窗口开始。冻结旧写/读请求至少 60 秒后再做最终导出，避免旧限速窗口继续生效造成行为差异。D1 的 `auth_rate_limits` 表不属于这个 binding，会正常迁移。

建议的切换顺序：

1. 先确认 ICP 备案已通过，配置/证书方案已经完成评审，R2 异机备份和磁盘空间已就绪；密钥由用户本人用 `set-secrets.sh` 配入，并确认 `/api/health` 的 `productionReady` 为 `true`。
2. 盘点所有旧入口。小程序云函数通过 `WORKER_ORIGIN` 使用 `api.shushugo.com`；Wrangler 当前仍启用 `workers_dev`，配置注释明确已有 iOS 客户端还指向 `*.workers.dev`。仅切自定义域名和云函数**不会冻结这些 iOS 写入**。必须先确定旧 iOS 入口如何停写/迁到新源站；未解决前不能宣称全量切换完成。
3. 在可回滚的维护窗口阻断旧 Worker 的所有请求入口（包括 `api.shushugo.com`、`workers.dev` 和任何其他直连入口），等待在途请求结束，再等待至少 60 秒。迁移窗口避开每天 03:17 UTC；如果窗口可能跨过该时间，须另行安排暂停旧 Worker Cron 的可回滚变更，因为 Cron 不受 HTTP 入口阻断影响。
4. 在本地运行迁移脚本；逐表行数和 D1 表名必须与冻结后的远端一致。通过 SSH 将归档复制到服务器后执行：

   ```sh
   sudo /opt/shushugo/cloudflare-sync/selfhost/install-migration.sh /tmp/shushugo-cloudflare-cutover.tar.gz
   ```

   安装器先校验归档路径/文件类型、SQLite、migration manifest、全部行数和 R2 对象数；然后停本地服务/定时器、保留迁移前 SQLite 备份及旧 R2 文件、安装导入数据、启动服务并检查 `/api/health`。失败时会恢复迁移前本地数据并重启服务/定时器。成功后旧文件仍留在 `rollback-*` 与 `backups/pre-import-*`，在人工确认前不要删除。
5. 从服务器本机再次 smoke `/api/health`、`/api/auth/config` 和真实用户授权后的必要读写路径。然后按已评审的证书/备案方案开放反代；小程序云函数更新 `WORKER_ORIGIN`，DNS 更新 `api.shushugo.com`。每一步分别验收，避免同时修改入口后无法定位故障。
6. 确认新入口、数据写入和备份都稳定后，才能另行决定何时停掉旧 Worker。Cloudflare 回滚不能只把 DNS/`WORKER_ORIGIN` 改回去：切流后新服务器接受的写入不会自动回到旧 D1。回滚前需冻结新写入并做反向数据同步，或明确接受丢弃切流后的新写入；不要让两套数据库同时接受写入。

迁移安装本身不变更 DNS、不部署 Worker、不改 CloudBase 云函数，也不删除 Cloudflare 数据。上述切换动作均留给备案完成后的单独操作。

## 本轮验收记录

**2026-09-27（本地代码和主机服务）**

- `npm test` 全部通过，含现有 Worker 路由、D1 round-trip 与新适配层/路由测试；`npm run check` 通过；`wrangler deploy --dry-run` 生成 Worker bundle（171.04 KiB，gzip 38.86 KiB），没有部署到 Cloudflare。
- 主机安装 Node `v22.23.3`（Node 官方 tarball SHA-256 校验通过）、`sqlite3`、`curl`、`ca-certificates`；apt 同时更新 `libsqlite3` / `libcurl` 运行库。没有安装 Caddy、没有改 sshd/22 端口或防火墙规则。
- `shushugo-worker.service`、scheduled timer、backup timer 均 active；手动运行 scheduled oneshot 成功。手动运行 `.backup` 成功，备份 `PRAGMA integrity_check` 为 `ok`，SQLite/备份均为 `0600`，密钥文件为 `root:root 0600`。
- 在主机执行 5 次 loopback curl：`/api/health` 全部 200，中位 `1.976 ms`；`/api/auth/config` 全部 200，中位 `1.483 ms`。健康 JSON 中 `migrationsApplied=true`，但 `ok=false`、`productionReady=false`，因为认证密钥尚未由用户输入。
- `ss -ltnp` 显示 Worker 只监听 `127.0.0.1:8787`；其余对外监听只有原有 SSH `*:22`。没有域名/HTTPS/公网流量验收；R2 异机备份仍待切流前安排。

这些证据只代表当前分支代码、主机本机服务和空白初始化数据库，不代表 Cloudflare 数据迁移、真实账号/设备或公开流量验收。没有执行远端 Cloudflare 数据读取、数据迁移、DNS、证书或流量切换。
