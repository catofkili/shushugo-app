#!/usr/bin/env bash
# 每日只读体检；唯一持久写入是本机 ~/.shushugo-health-state。见 docs/claude/prod-health.md。
set -uo pipefail

prod_health_sql() {
  [[ $1 =~ ^[0-9]+$ && $2 =~ ^[0-9]+$ ]] || return 2
  cat <<SQL
BEGIN;
WITH latest AS (
  SELECT user_id, MAX(julianday(created_at)) AS jd FROM sync_objects GROUP BY user_id
), missing AS (
  SELECT u.id, u.display_name, u.last_login,
         strftime('%Y-%m-%dT%H:%M:%fZ', s.jd) AS latest_snapshot_at
  FROM users u LEFT JOIN latest s ON s.user_id = u.id
  WHERE julianday(u.last_login) >= julianday($2, 'unixepoch', '-14 days')
    AND (s.jd IS NULL OR s.jd < julianday(u.last_login, '-3 days'))
), details AS (
  SELECT json_object('id', id, 'name', display_name, 'last_login', last_login,
                     'latest_snapshot_at', latest_snapshot_at) AS line
  FROM missing ORDER BY julianday(last_login) DESC, id LIMIT 20
)
SELECT CASE WHEN COUNT(*) > 0 THEN 'WARN' ELSE 'OK' END
  || ' 云备份 — ' || COUNT(*) || ' 个近期活跃账号无快照或落后登录超过 3 天；总账号='
  || (SELECT COUNT(*) FROM users) || ' 微信账号='
  || (SELECT COUNT(*) FROM users WHERE email LIKE 'wechat-%') || ' 有快照账号='
  || (SELECT COUNT(DISTINCT user_id) FROM sync_objects)
  || coalesce((SELECT char(10) || group_concat('  ' || line, char(10)) FROM details), '')
FROM missing;

WITH fresh AS (
  SELECT * FROM feedback_reports
  WHERE created_at >= CASE WHEN $1 = 0 THEN $2 - 259200 ELSE $1 END AND created_at < $2
), details AS (
  SELECT json_object('time', strftime('%Y-%m-%dT%H:%M:%SZ', created_at, 'unixepoch'),
    'kind', kind, 'platform', platform, 'version', app_version, 'message', substr(message, 1, 200)) AS line
  FROM fresh ORDER BY created_at DESC, id LIMIT 20
)
SELECT CASE WHEN COUNT(*) > 0 THEN 'WARN' ELSE 'OK' END || ' 新反馈 — '
  || COUNT(*) || ' 条新增（明细最多 20 条）'
  || coalesce((SELECT char(10) || group_concat('  ' || line, char(10)) FROM details), '')
FROM fresh;

-- verified/revoked 才是实际验单/撤销；unpaid/rejected 等失败尝试不覆盖最后有效证据。
WITH ranked AS (
  SELECT p.*, row_number() OVER (
    PARTITION BY user_id, coalesce(original_transaction_id, transaction_id)
    ORDER BY julianday(created_at) DESC, CASE WHEN status = 'verified' THEN 0 ELSE 1 END DESC, id DESC
  ) AS rn
  FROM purchase_events p
  WHERE status IN ('verified', 'revoked', 'subscription_status_2', 'subscription_status_3', 'subscription_status_5')
), latest AS (SELECT * FROM ranked WHERE rn = 1), rights AS (
  SELECT *, coalesce(is_pro = 1 AND (expires_at IS NULL OR julianday(expires_at) > julianday($2, 'unixepoch')), 0) AS active
  FROM entitlements
), candidates AS (
  SELECT 'wechat' AS channel, w.user_id, w.out_trade_no AS original_id, w.product_id,
         w.status, p.status AS event_status, coalesce(p.created_at, w.created_at) AS verified_at,
         coalesce(p.environment, e.environment, 'unknown') AS environment, p.raw_payload,
         g.expires_at AS gift_expires_at,
         e.is_pro, e.source, e.product_id AS entitlement_product, e.original_transaction_id AS entitlement_original,
         e.expires_at, coalesce(e.active, 0) AS active
  FROM wechat_orders w LEFT JOIN latest p ON p.user_id = w.user_id AND p.original_transaction_id = w.out_trade_no
  LEFT JOIN rights e ON e.user_id = w.user_id LEFT JOIN launch_gift_grants g ON g.user_id = w.user_id
  WHERE (w.status IN ('paid', 'delivered') AND
    (coalesce(e.active, 0) = 0 OR e.source = 'trial' OR
      (w.product_id = 'shushugo_pro_lifetime' AND lower(coalesce(p.environment, e.environment, '')) = 'production'
        AND (e.product_id IS NOT 'shushugo_pro_lifetime' OR e.expires_at IS NOT NULL))))
    OR (w.status = 'refunded' AND e.active = 1 AND e.original_transaction_id = w.out_trade_no)
  UNION ALL
  SELECT 'apple', p.user_id, coalesce(p.original_transaction_id, p.transaction_id), p.product_id,
         p.status, p.status, p.created_at, p.environment, p.raw_payload, NULL,
         e.is_pro, e.source, e.product_id, e.original_transaction_id, e.expires_at, coalesce(e.active, 0)
  FROM latest p LEFT JOIN rights e ON e.user_id = p.user_id
  WHERE NOT EXISTS (SELECT 1 FROM wechat_orders w
    WHERE w.user_id = p.user_id AND w.out_trade_no = coalesce(p.original_transaction_id, p.transaction_id))
  AND ((p.status = 'verified' AND
    (coalesce(e.active, 0) = 0 OR e.source = 'trial' OR
      (p.product_id = 'shushugo_pro_lifetime' AND lower(coalesce(p.environment, '')) = 'production'
        AND (e.product_id IS NOT 'shushugo_pro_lifetime' OR e.expires_at IS NOT NULL))))
    OR (p.status IN ('revoked', 'subscription_status_5') AND e.active = 1
      AND e.original_transaction_id = coalesce(p.original_transaction_id, p.transaction_id)))
)
SELECT 'HEALTH_PAYMENTS ' || json_group_array(json_object(
  'channel', channel, 'user_id', user_id, 'original_id', original_id, 'product_id', product_id,
  'status', status, 'event_status', event_status, 'verified_at', verified_at, 'environment', environment,
  'raw_payload', raw_payload, 'gift_expires_at', gift_expires_at, 'is_pro', is_pro, 'source', source,
  'entitlement_product', entitlement_product, 'entitlement_original', entitlement_original,
  'expires_at', expires_at, 'active', active
)) FROM candidates;

WITH ranked AS (
  SELECT *, row_number() OVER w AS rn, lead(byte_length) OVER w AS previous_bytes,
         lead(compression) OVER w AS previous_compression, lead(snapshot_format) OVER w AS previous_format
  FROM sync_objects
  WINDOW w AS (PARTITION BY user_id ORDER BY generation DESC, julianday(created_at) DESC, id DESC)
), shrunk AS (
  SELECT * FROM ranked WHERE rn = 1 AND previous_bytes > 51200 AND byte_length * 2 < previous_bytes
), details AS (
  SELECT json_object('user_id', user_id, 'generation', generation, 'time', created_at,
    'bytes', byte_length, 'previous_bytes', previous_bytes, 'compression', compression,
    'previous_compression', previous_compression, 'format', snapshot_format, 'previous_format', previous_format) AS line
  FROM shrunk ORDER BY byte_length * 1.0 / previous_bytes, user_id LIMIT 20
)
SELECT CASE WHEN COUNT(*) > 0 THEN 'WARN' ELSE 'OK' END || ' 快照骤缩 — '
  || COUNT(*) || ' 个账号最新快照缩小超过一半（前份 > 50 KiB）'
  || coalesce((SELECT char(10) || group_concat('  ' || line, char(10)) FROM details), '')
FROM shrunk;

WITH failures AS (
  SELECT kind, COUNT(*) AS n FROM feedback_reports
  WHERE created_at >= $2 - 86400 AND created_at < $2
    AND kind IN ('persist-fail', 'archive-unreadable', 'sync-fail', 'login-fail') GROUP BY kind
)
SELECT CASE WHEN coalesce(SUM(n), 0) > 0 THEN 'WARN' ELSE 'OK' END || ' 客户端失败 — '
  || coalesce(SUM(n), 0) || ' 次/24h；新 kind 尚需迁移，0 不代表设备未出错'
  || coalesce((SELECT char(10) || group_concat('  ' || kind || '=' || n, char(10)) FROM failures), '')
FROM failures;
COMMIT;
SQL
}

prod_health_report() { printf '%s %s — %s\n' "$1" "$2" "$3"; }
prod_health_details() { printf '%s\n' "$1" | sed -n '1,20s/^/  /p'; }

prod_health_payments() {
  # 交易正文是 JWS，SQLite 无 base64url 解码；只在本机解析已入库的验单证据，不请求支付平台。
  if ! command -v python3 >/dev/null; then prod_health_report FAIL 付款 '本机缺少 python3，无法解析验单证据'; return 2; fi
  python3 -c "$(cat <<'PY'
import base64, calendar, datetime as dt, json, sys

def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() if value else None

def payload(jws):
    part = jws.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))

def expected_expiry(row):
    raw = json.loads(row['raw_payload'] or '{}')
    if row['channel'] == 'apple':
        if 'signedTransactionInfo' in raw:
            tx = payload(raw['signedTransactionInfo'])
        else:
            choices = []
            for group in raw.get('data', []):
                for item in group.get('lastTransactions', []):
                    tx = payload(item['signedTransactionInfo'])
                    if (item.get('originalTransactionId') or tx.get('originalTransactionId')) != row['original_id']:
                        continue
                    if item.get('status') == 4 and item.get('signedRenewalInfo'):
                        tx['expiresDate'] = payload(item['signedRenewalInfo']).get('gracePeriodExpiresDate', tx.get('expiresDate'))
                    choices.append((item.get('status') in (1, 4), tx.get('expiresDate', tx.get('purchaseDate', 0)), tx))
            if not choices:
                raise ValueError('缺少可读 Apple 交易正文')
            tx = max(choices, key=lambda choice: choice[:2])[2]
        if tx.get('revocationDate'):
            return 0
        expiry = tx.get('expiresDate')
        if expiry is None and row['product_id'] != 'shushugo_pro_lifetime':
            raise ValueError('订阅缺少到期证据')
        expiry = expiry / 1000 if expiry is not None else None
    else:
        if row['product_id'] == 'shushugo_pro_lifetime':
            expiry = None
        else:
            paid_at = raw.get('order', {}).get('paid_time')
            if not paid_at:
                raise ValueError('微信期限卡缺少 paid_time')
            start = max(float(paid_at), timestamp(row['gift_expires_at']) or 0)
            date = dt.datetime.fromtimestamp(start, dt.timezone(dt.timedelta(hours=8)))
            months = {'shushugo_pro_monthly': 1, 'shushugo_pro_quarterly': 3, 'shushugo_pro_yearly': 12}[row['product_id']]
            year, month = divmod(date.year * 12 + date.month - 1 + months, 12)
            expiry = date.replace(year=year, month=month + 1, day=min(date.day, calendar.monthrange(year, month + 1)[1])).timestamp()
    if (row['environment'] or '').lower() == 'sandbox':
        cap = timestamp(row['verified_at']) + 30 * 86400
        expiry = min(expiry, cap) if expiry is not None else cap
    elif row['channel'] == 'wechat' and row['environment'] == 'unknown':
        raise ValueError('缺少正式/沙盒环境证据')
    return expiry

try:
    now = int(sys.argv[1])
    findings = []
    for row in json.load(sys.stdin):
        severity = 'FAIL'
        if row['status'] in ('refunded', 'revoked', 'subscription_status_5') or row['event_status'] in ('revoked', 'subscription_status_5'):
            if not row['active'] or row['entitlement_original'] != row['original_id']:
                continue
            reason = '退款/撤销的同一交易仍提供有效 Pro'
        else:
            try:
                expiry = expected_expiry(row)
                if expiry is not None and expiry <= now:
                    continue
                reason = '已付款且仍在有效期，付费权益未生效或永久权益被降级'
            except (ValueError, TypeError, KeyError, IndexError, OverflowError):
                # 不把无法确定到期日的历史订阅当漏发；也不能因此静默报 OK。
                severity, reason = 'WARN', '已付款但缺少有效权益；到期证据不全，需人工核对'
        findings.append((severity, {key: row[key] for key in ('channel', 'user_id', 'original_id', 'product_id', 'status', 'expires_at')} | {'reason': reason}))
    failures = sum(severity == 'FAIL' for severity, _ in findings)
    users = len({row['user_id'] for _, row in findings})
    print(f"{'FAIL' if failures else 'WARN' if findings else 'OK'} 付款 — {users} 个账号/{len(findings)} 项异常；已确认={failures}，待核对={len(findings) - failures}")
    for _, row in sorted(findings, key=lambda finding: finding[0])[:20]:
        print('  ' + json.dumps(row, ensure_ascii=False))
except Exception as error:
    print('FAIL 付款 — 无法解析验单证据：' + type(error).__name__)
    sys.exit(2)
PY
)" "$1"
}

prod_health_journal() {
  local groups count
  groups=$(printf '%s\n' "$1" | LC_ALL=C awk '
    tolower($0) ~ /error|exception/ || $0 ~ /(^|[^0-9])5[0-9][0-9]([^0-9]|$)/ {
      line = $0; gsub(/[[:cntrl:]]/, " ", line); gsub(/https?:\/\/[^ ]+/, "<url>", line)
      gsub(/[0-9]+/, "#", line); gsub(/[[:space:]]+/, " ", line); n[line]++
    }
    END { for (line in n) printf "%d\t%s\n", n[line], line }
  ')
  count=$(printf '%s\n' "$groups" | awk '{n += $1} END {print n+0}')
  if (( count > 0 )); then
    prod_health_report WARN 服务器报错 "$count 行/24h（同一行只计一次，按文本归并前 5 种）"
    printf '%s\n' "$groups" | LC_ALL=C sort -nr | sed -n '1,5s/^/  /p'
  else
    prod_health_report OK 服务器报错 '0 行/24h'
  fi
}

prod_health_timer() {
  local unit=$1 name=$2 now=$3 info key value result= status= started= active= age
  if ! info=$(systemctl show "shushugo-worker-$unit.timer" -p ActiveState --value 2>&1); then
    prod_health_report FAIL "$name" '无法读取 timer'; prod_health_details "$info"; return
  fi
  active=$info
  if ! info=$(systemctl show "shushugo-worker-$unit.service" -p Result -p ExecMainStatus -p ExecMainStartTimestamp 2>&1); then
    prod_health_report FAIL "$name" '无法读取上次任务结果'; prod_health_details "$info"; return
  fi
  while IFS='=' read -r key value; do
    case "$key" in Result) result=$value ;; ExecMainStatus) status=$value ;; ExecMainStartTimestamp) started=$value ;; esac
  done <<< "$info"
  if [[ $active != active || $result != success || $status != 0 ]]; then
    prod_health_report FAIL "$name" "timer=${active}，上次 Result=$result / exit=$status"; prod_health_details "$info"
  elif [[ -z $started ]] || ! started=$(date -d "$started" +%s 2>/dev/null); then
    prod_health_report WARN "$name" 'timer 活跃，但本次开机尚无可核对的运行时间'
    prod_health_details "$info"
  else
    age=$((now - started))
    if (( age > 129600 || age < -300 )); then
      prod_health_report WARN "$name" "上次成功执行距今 $((age / 3600)) 小时（阈值 36h）"
      prod_health_details "$info"
    else
      prod_health_report OK "$name" "timer 活跃，上次成功执行距今 $((age / 3600)) 小时"
    fi
  fi
}

prod_health_remote() {
  local since=$1 now output latest mtime size file age disk usage
  now=$(date -u +%s) || return 2
  [[ $now =~ ^[0-9]+$ ]] || return 2
  if (( since > now )); then
    prod_health_report FAIL 状态文件 '上次游标晚于服务器时间，本次回看 3 天；不推进游标'
    since=0
  fi
  if output=$(prod_health_sql "$since" "$now" | sudo -n sqlite3 -bail -readonly -batch -noheader -cmd '.timeout 5000' /var/lib/shushugo/worker.sqlite 2>&1); then
    printf '%s\n' "$output"
    printf 'HEALTH_STATE %s\n' "$now"
  else
    for item in 云备份 新反馈 付款 快照骤缩 客户端失败; do
      prod_health_report FAIL "$item" '只读 SQL 查询失败，未推进反馈游标'; prod_health_details "$output"
    done
  fi
  if output=$(sudo -n journalctl -q -u shushugo-worker.service --since '-24 hours' --no-pager -o cat 2>&1); then
    prod_health_journal "$output"
  else
    prod_health_report FAIL 服务器报错 '无法读取 journal'; prod_health_details "$output"
  fi
  prod_health_timer backup 备份任务 "$now"
  if latest=$(sudo -n find /var/lib/shushugo/backups -maxdepth 1 -type f -name 'worker-*.sqlite' -printf '%T@ %s %f\n' 2>&1 | LC_ALL=C sort -nr | sed -n '1p'); then
    read -r mtime size file <<< "$latest"
    mtime=${mtime%.*}
    if [[ $mtime =~ ^[0-9]+$ && $size =~ ^[0-9]+$ ]] && (( size > 0 )); then
      age=$((now - mtime))
      if (( age > 129600 || age < -300 )); then
        prod_health_report FAIL 备份文件 "$file 距今 $((age / 3600)) 小时；要求 36h 内且时间不在未来"
        prod_health_details "$latest"
      else
        prod_health_report OK 备份文件 "${file}，$size 字节，距今 $((age / 3600)) 小时"
      fi
    else
      prod_health_report FAIL 备份文件 '没有可用的非空 worker-*.sqlite 文件'; prod_health_details "$latest"
    fi
  else
    prod_health_report FAIL 备份文件 '无法读取备份目录'; prod_health_details "$latest"
  fi
  prod_health_timer scheduled 定时任务 "$now"
  if disk=$(df -P /var/lib/shushugo 2>&1); then
    usage=$(printf '%s\n' "$disk" | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')
    if [[ ! $usage =~ ^[0-9]+$ ]]; then
      prod_health_report FAIL 磁盘 '无法解析数据盘使用率'; prod_health_details "$disk"
    elif (( usage > 80 )); then
      prod_health_report WARN 磁盘 "数据盘使用率 $usage% > 80%"; prod_health_details "$disk"
    else
      prod_health_report OK 磁盘 "数据盘使用率 $usage%"
    fi
  else
    prod_health_report FAIL 磁盘 '无法读取数据盘'; prod_health_details "$disk"
  fi
  printf 'HEALTH_COMPLETE\n'
}

prod_health_run() {
  local state=$1 since=0 state_valid=1 output line cursor= complete=0 sql_ok=1 http_code
  if [[ -e $state ]]; then
    since=$(cat "$state" 2>/dev/null) || state_valid=0
    if [[ ! $since =~ ^[1-9][0-9]{0,9}$ ]]; then state_valid=0; fi
    if (( ! state_valid )); then
      prod_health_report FAIL 状态文件 '无法读取有效时间戳；回看 3 天，不覆盖原文件'
      since=0
    fi
  fi
  if output=$(
    { declare -f prod_health_sql prod_health_report prod_health_details prod_health_journal prod_health_timer prod_health_remote
      printf 'set -uo pipefail\nprod_health_remote %s\n' "$since"
    } | ssh -i "$HOME/.ssh/shushugo_server" -o BatchMode=yes -o ConnectTimeout=10 \
      -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=yes -o UpdateHostKeys=no \
      admin@8.148.68.155 'bash -s' 2>&1
  ); then
    while IFS= read -r line; do
      case "$line" in
        'HEALTH_PAYMENTS '*) printf '%s\n' "${line#HEALTH_PAYMENTS }" | prod_health_payments "$(printf '%s\n' "$output" | sed -n 's/^HEALTH_STATE //p')" || sql_ok=0 ;;
        'HEALTH_STATE '*) cursor=${line#HEALTH_STATE } ;;
        HEALTH_COMPLETE) complete=1 ;;
        'FAIL 状态文件 '*) state_valid=0; printf '%s\n' "$line" ;;
        OK\ *|WARN\ *|FAIL\ *|'  '*) printf '%s\n' "$line" ;;
        *) prod_health_report FAIL 远端输出 '收到未识别的体检输出'; prod_health_details "$line"; sql_ok=0 ;;
      esac
    done <<< "$output"
    if (( ! complete )); then prod_health_report FAIL SSH '远端输出不完整；未推进反馈游标'; fi
    if (( complete && state_valid && sql_ok )) && [[ $cursor =~ ^[0-9]{1,10}$ ]]; then
      if ! (umask 077; printf '%s\n' "$cursor" > "$state"); then
        prod_health_report FAIL 状态文件 '写入失败，下次仍会报告同一批反馈'
      fi
    fi
  else
    prod_health_report FAIL SSH '无法完成服务器只读体检；未推进反馈游标'; prod_health_details "$output"
  fi
  if http_code=$(curl --silent --show-error --connect-timeout 10 --max-time 20 --output /dev/null \
    --write-out '%{http_code}' https://api.shushugo.com/api/health 2>&1) && [[ $http_code == 200 ]]; then
    prod_health_report OK /api/health 'HTTP 200'
  else
    prod_health_report FAIL /api/health '未返回 HTTP 200'; prod_health_details "$http_code"
  fi
}

prod_health_main() {
  prod_health_run "$1" | LC_ALL=C awk '
    {print}
    /^OK / {ok++} /^WARN / {warn++} /^FAIL / {fail++}
    END {printf "SUMMARY ok=%d warn=%d fail=%d\n", ok, warn, fail; exit (fail ? 2 : warn ? 1 : 0)}
  '
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  prod_health_main "$HOME/.shushugo-health-state"
fi
