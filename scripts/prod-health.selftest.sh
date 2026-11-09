#!/usr/bin/env bash
# 只用迁移建出的临时库和命令替身，不连接生产、不读写真实体检游标。
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/shushugo-prod-health.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
source "$root/scripts/prod-health.sh"
set -e
now=1794218400 # 2026-11-09 10:00:00 UTC
prod_health_sql 0 "$now" > "$scratch/checks.sql"

python3 - "$root" "$scratch" "$now" <<'PY'
import base64, datetime as dt, json, pathlib, sqlite3, sys
root, scratch, now = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), int(sys.argv[3])
db = sqlite3.connect(scratch / 'empty.sqlite')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((root / 'cloudflare-sync/migrations').glob('*.sql')):
    db.executescript(migration.read_text())
db.commit()
db.backup(sqlite3.connect(scratch / 'fixture.sqlite'))
db.close()
db = sqlite3.connect(scratch / 'fixture.sqlite')

def iso(seconds):
    return dt.datetime.fromtimestamp(seconds, dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def user(name, login=None):
    db.execute('INSERT INTO users(id,email,password_hash,password_salt,created_at,last_login,display_name) VALUES(?,?,?,?,?,?,?)',
               (name, 'wechat-' + name, 'not-a-password', 'fixture', iso(now - 86400 * 30), login, name))

def snapshot(name, generation, size, at):
    key = f'{name}-{generation}'
    db.execute('INSERT INTO sync_objects(id,user_id,object_key,last_modified,created_at,byte_length,generation) VALUES(?,?,?,?,?,?,?)',
               (key, name, key, iso(at), iso(at), size, generation))

def entitlement(name, original, product='lifetime', expiry=None, pro=1, source='app_store'):
    db.execute('INSERT INTO entitlements(user_id,is_pro,product_id,source,original_transaction_id,expires_at,updated_at) VALUES(?,?,?,?,?,?,?)',
               (name, pro, 'shushugo_pro_' + product, source, original, iso(expiry) if expiry else None, iso(now)))

def jws(tx):
    encoded = base64.urlsafe_b64encode(json.dumps(tx).encode()).decode().rstrip('=')
    return 'e30.' + encoded + '.fixture'

def event(name, product='lifetime', status='verified', at=None, raw=None, environment='Production', original=None):
    original = original or name
    db.execute('INSERT INTO purchase_events(id,user_id,product_id,transaction_id,original_transaction_id,environment,status,raw_payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
               (name + status, name, 'shushugo_pro_' + product, name + '-tx', original, environment, status,
                json.dumps(raw) if raw is not None else None, iso(at or now - 60)))

def apple(name, product='lifetime', expiry=None, status='verified', **kwargs):
    tx = {'originalTransactionId': name, 'productId': 'shushugo_pro_' + product, 'private': 'PAYLOAD_MUST_NOT_APPEAR'}
    if expiry is not None:
        tx['expiresDate'] = expiry * 1000
    event(name, product, status, raw={'signedTransactionInfo': jws(tx)}, **kwargs)

def wechat(name, product='lifetime', status='paid', paid_at=None, raw=True):
    db.execute('INSERT INTO wechat_orders(out_trade_no,user_id,openid,product_id,price_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
               (name, name, 'fixture-openid', 'shushugo_pro_' + product, 100, status, iso(now - 90), iso(now - 30)))
    if raw:
        event(name, product, 'revoked' if status == 'refunded' else 'verified', environment='production',
              raw={'order': {'paid_time': paid_at or now - 60}})

user('no-snapshot', iso(now))
user('head-only', iso(now))
db.execute('INSERT INTO sync_heads(user_id,updated_at) VALUES(?,?)', ('head-only', iso(now)))
user('stale', dt.datetime.fromtimestamp(now, dt.timezone(dt.timedelta(hours=8))).isoformat())
snapshot('stale', 1, 1000, now - 3 * 86400 - 1)
user('three-days-exact', iso(now))
snapshot('three-days-exact', 1, 1000, now - 3 * 86400)
user('fourteen-days-exact', iso(now - 14 * 86400))
user('inactive', iso(now - 14 * 86400 - 1))
for name, previous, latest in [('shrink', 100001, 1000), ('half-exact', 60000, 30000), ('small', 51200, 1)]:
    user(name)
    snapshot(name, 1, previous, now - 3600)
    snapshot(name, 2, latest, now - 60)

for name in ['wx-missing', 'wx-refund', 'wx-repurchased', 'wx-expired', 'wx-gift', 'wx-unknown',
             'apple-missing', 'apple-month', 'apple-expired', 'apple-refund', 'apple-repurchased',
             'apple-sandbox-expired', 'apple-upgraded', 'apple-downgraded', 'apple-unknown', 'apple-grace', 'apple-cancelled']:
    user(name)
wechat('wx-missing')
wechat('wx-refund', status='refunded')
entitlement('wx-refund', 'wx-refund', source='wechat')
wechat('wx-repurchased', status='refunded')
entitlement('wx-repurchased', 'different-paid-order', source='wechat')
wechat('wx-expired', product='monthly', paid_at=now - 90 * 86400)
wechat('wx-gift', product='monthly', paid_at=now - 90 * 86400)
db.execute('INSERT INTO launch_gift_grants(user_id,granted_at,expires_at) VALUES(?,?,?)', ('wx-gift', iso(now - 100 * 86400), iso(now + 86400)))
wechat('wx-unknown', raw=False)
apple('apple-missing')
apple('apple-month', product='monthly', expiry=now + 86400)
apple('apple-expired', product='monthly', expiry=now - 1)
apple('apple-refund', status='revoked')
entitlement('apple-refund', 'apple-refund')
apple('apple-repurchased', status='revoked')
entitlement('apple-repurchased', 'different-original')
apple('apple-sandbox-expired', environment='Sandbox', at=now - 31 * 86400)
apple('apple-upgraded', product='monthly', expiry=now + 86400)
entitlement('apple-upgraded', 'different-lifetime')
apple('apple-downgraded')
entitlement('apple-downgraded', 'different-month', product='monthly', expiry=now + 86400)
apple('apple-unknown', product='monthly')
event('apple-grace', product='monthly', raw={'data': [{'lastTransactions': [{
    'originalTransactionId': 'apple-grace', 'status': 4,
    'signedTransactionInfo': jws({'originalTransactionId': 'apple-grace', 'expiresDate': (now - 1) * 1000}),
    'signedRenewalInfo': jws({'gracePeriodExpiresDate': (now + 86400) * 1000})
}]}]})
apple('apple-cancelled', product='monthly', expiry=now + 86400, at=now - 3600)
event('apple-cancelled', product='monthly', status='subscription_status_2')

for ident, at, message in [('new', now - 60, '𠮷' * 205 + 'SECRET_TAIL'), ('boundary', now - 3 * 86400, 'three-day boundary'),
                         ('old', now - 3 * 86400 - 1, 'OLD_FEEDBACK'), ('next', now, 'NEXT_RUN_FEEDBACK')]:
    db.execute('INSERT INTO feedback_reports(id,created_at,kind,message,platform,app_version,route,client_hash) VALUES(?,?,?,?,?,?,?,?)',
               (ident, at, 'feedback', message, 'weapp', 'test', 'profile', 'fixture'))

# 保留迁移原约束并证明 B 确实被它阻塞。仅此临时库用忽略约束构造未来 kind 的聚合夹具。
try:
    db.execute("INSERT INTO feedback_reports(id,created_at,kind,message,platform,app_version,route,client_hash) VALUES('blocked',?,'persist-fail','test','web','test','home','fixture')", (now - 1,))
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('0017 must reject new kinds without a migration')
db.execute('PRAGMA ignore_check_constraints=ON')
for index, kind in enumerate(['persist-fail', 'archive-unreadable', 'sync-fail', 'login-fail']):
    db.execute('INSERT INTO feedback_reports(id,created_at,kind,message,platform,app_version,route,client_hash) VALUES(?,?,?,?,?,?,?,?)',
               (kind, now - index - 1, kind, 'failure category only', 'weapp', 'test', 'profile', 'fixture'))
db.commit()
db.close()
print('OK migrations: all applied to temporary SQLite; existing kind constraint blocks B')
PY

sqlite3 -bail -readonly "$scratch/empty.sqlite" < "$scratch/checks.sql" > "$scratch/empty.out"
sqlite3 -bail -readonly "$scratch/fixture.sqlite" < "$scratch/checks.sql" > "$scratch/sql.out"
sed -n 's/^HEALTH_PAYMENTS //p' "$scratch/sql.out" | prod_health_payments "$now" > "$scratch/payments.out"

python3 - "$scratch" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
empty = (path / 'empty.out').read_text()
assert sum(line.startswith('OK ') for line in empty.splitlines()) == 4
assert 'HEALTH_PAYMENTS []' in empty
result = (path / 'sql.out').read_text()
assert 'WARN 云备份 — 4 个' in result
assert 'WARN 新反馈 — 6 条' in result
assert 'WARN 快照骤缩 — 1 个' in result
assert 'WARN 客户端失败 — 4 次' in result
for kind in ['persist-fail', 'archive-unreadable', 'sync-fail', 'login-fail']:
    assert f'  {kind}=1' in result
for excluded in ['three-days-exact', 'inactive', 'half-exact', 'small', 'SECRET_TAIL', 'OLD_FEEDBACK', 'NEXT_RUN_FEEDBACK']:
    assert excluded not in result, excluded
feedback = [json.loads(line[2:]) for line in result.splitlines() if line.startswith('  {') and '"message"' in line]
assert len(next(row['message'] for row in feedback if row['message'].startswith('𠮷'))) == 200
payments = (path / 'payments.out').read_text()
rows = [json.loads(line[2:]) for line in payments.splitlines() if line.startswith('  {')]
expected_fail = {'wx-missing', 'wx-refund', 'wx-gift', 'apple-missing', 'apple-month', 'apple-refund', 'apple-downgraded', 'apple-grace'}
expected_warn = {'wx-unknown', 'apple-unknown'}
assert {row['user_id'] for row in rows} == expected_fail | expected_warn, payments
assert '已确认=8，待核对=2' in payments
assert 'PAYLOAD_MUST_NOT_APPEAR' not in payments
print('OK SQL: cloud/login time zones and 3d/14d boundaries, feedback cursor/200 characters, payments/refunds/expiry/grace/gift/sandbox, 50 KiB/half boundaries, failure kinds')
PY

# 所有生产 SSH/HTTP/系统工具都被替换；ssh 收到的真实脚本在本机执行同一份只读 SQL。
mkdir "$scratch/bin"
cat > "$scratch/bin/mock" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${0##*/}" in
  ssh)
    printf 'ssh\n' >> "$PROD_TEST_SCRATCH/connections"
    if [[ ${PROD_TEST_SSH_FAIL:-0} == 1 ]]; then printf 'connection refused\n' >&2; exit 255; fi
    exec bash -s ;;
  sudo)
    shift
    case "$1" in
      sqlite3)
        shift; args=()
        for arg in "$@"; do
          if [[ $arg == /var/lib/shushugo/worker.sqlite ]]; then args+=("$PROD_TEST_DB"); else args+=("$arg"); fi
        done
        exec "$PROD_TEST_SQLITE" "${args[@]}" ;;
      journalctl)
        if [[ ${PROD_TEST_JOURNAL_FAIL:-0} == 1 ]]; then printf 'permission denied\n'; exit 1; fi
        printf '%s\n' "${PROD_TEST_JOURNAL:-}" ;;
      find)
        if [[ ${PROD_TEST_NO_BACKUP:-0} == 0 ]]; then
          printf '%s.000 12345 worker-2026-11-09.sqlite\n' "$((PROD_TEST_NOW - ${PROD_TEST_BACKUP_AGE:-3600}))"
        fi ;;
      *) exit 90 ;;
    esac ;;
  date)
    if [[ $1 == -u ]]; then printf '%s\n' "$PROD_TEST_NOW"; else printf '%s\n' "$((PROD_TEST_NOW - ${PROD_TEST_TIMER_AGE:-3600}))"; fi ;;
  systemctl)
    if [[ $* == *--value* ]]; then
      printf '%s\n' "${PROD_TEST_TIMER_ACTIVE:-active}"
    else
      printf 'Result=%s\nExecMainStatus=0\nExecMainStartTimestamp=fixture\n' "${PROD_TEST_TIMER_RESULT:-success}"
    fi ;;
  df) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/fixture 100 40 60 %s%% /var/lib/shushugo\n' "${PROD_TEST_DISK:-40}" ;;
  curl) printf '%s' "${PROD_TEST_HTTP:-200}" ;;
  *) exit 91 ;;
esac
SH
chmod +x "$scratch/bin/mock"
for tool in ssh sudo date systemctl df curl; do ln -s mock "$scratch/bin/$tool"; done
export PROD_TEST_SCRATCH="$scratch" PROD_TEST_NOW="$now" PROD_TEST_SQLITE
PROD_TEST_SQLITE=$(command -v sqlite3)
export PROD_TEST_DB="$scratch/empty.sqlite"
original_path=$PATH
export PATH="$scratch/bin:$PATH"

run_case() {
  local expected=$1 name=$2 actual=0
  shift 2
  : > "$scratch/connections"
  prod_health_main "$scratch/state" > "$scratch/$name.out" || actual=$?
  if [[ $actual != "$expected" ]]; then cat "$scratch/$name.out"; printf 'FAIL %s exit=%s expected=%s\n' "$name" "$actual" "$expected"; exit 1; fi
  [[ $(wc -l < "$scratch/connections") -eq 1 ]]
  [[ $(tail -n 1 "$scratch/$name.out") == SUMMARY\ ok=*\ warn=*\ fail=* ]]
  for text in "$@"; do
    if ! grep -Fq -- "$text" "$scratch/$name.out"; then cat "$scratch/$name.out"; printf 'Missing: %s\n' "$text"; exit 1; fi
  done
}

run_case 0 healthy 'SUMMARY ok=11 warn=0 fail=0'
[[ $(cat "$scratch/state") == "$now" ]]
export PROD_TEST_DB="$scratch/fixture.sqlite"
printf '%s\n' "$((now - 3 * 86400))" > "$scratch/state"
run_case 2 anomalies 'WARN 云备份 — 4 个' 'WARN 新反馈 — 6 条' 'FAIL 付款 — 10 个账号/10 项异常' 'WARN 快照骤缩 — 1 个' 'WARN 客户端失败 — 4 次'
run_case 2 next-run 'OK 新反馈 — 0 条'
[[ $(cat "$scratch/state") == "$now" ]]
export PROD_TEST_NOW=$((now + 1))
run_case 2 second-boundary 'WARN 新反馈 — 1 条' 'NEXT_RUN_FEEDBACK'
export PROD_TEST_NOW=$now
printf '%s\n' "$now" > "$scratch/state"

export PROD_TEST_DB="$scratch/empty.sqlite" PROD_TEST_DISK=80
run_case 0 disk-boundary 'OK 磁盘 — 数据盘使用率 80%'
export PROD_TEST_DISK=81
run_case 1 disk-warning 'WARN 磁盘 — 数据盘使用率 81%'
unset PROD_TEST_DISK
export PROD_TEST_JOURNAL=$'HTTP 500 error user 123\nHTTP 503 error user 456\nTypeError: cannot read 7\nHTTP 200 normal'
run_case 1 logs 'WARN 服务器报错 — 3 行/24h' $'  2\tHTTP # error user #'
unset PROD_TEST_JOURNAL
export PROD_TEST_JOURNAL_FAIL=1
run_case 2 logs-unreadable 'FAIL 服务器报错'
unset PROD_TEST_JOURNAL_FAIL
export PROD_TEST_BACKUP_AGE=129600
run_case 0 backup-boundary 'OK 备份文件'
export PROD_TEST_BACKUP_AGE=129601
run_case 2 backup-stale 'FAIL 备份文件'
unset PROD_TEST_BACKUP_AGE
export PROD_TEST_NO_BACKUP=1
run_case 2 backup-missing 'FAIL 备份文件'
unset PROD_TEST_NO_BACKUP
export PROD_TEST_TIMER_RESULT=exit-code
run_case 2 timer-failed 'FAIL 备份任务' 'FAIL 定时任务'
unset PROD_TEST_TIMER_RESULT
export PROD_TEST_TIMER_ACTIVE=inactive
run_case 2 timer-disabled 'FAIL 备份任务' 'FAIL 定时任务'
unset PROD_TEST_TIMER_ACTIVE
export PROD_TEST_HTTP=503
run_case 2 http-failed 'FAIL /api/health'
unset PROD_TEST_HTTP

printf '%s\n' "$((now - 100))" > "$scratch/state"
export PROD_TEST_SSH_FAIL=1
run_case 2 ssh-failed 'FAIL SSH' 'OK /api/health'
[[ $(cat "$scratch/state") == "$((now - 100))" ]]
unset PROD_TEST_SSH_FAIL
cp "$scratch/empty.sqlite" "$scratch/broken.sqlite"
"$PROD_TEST_SQLITE" "$scratch/broken.sqlite" 'DROP TABLE feedback_reports;'
export PROD_TEST_DB="$scratch/broken.sqlite"
run_case 2 sql-failed 'FAIL 云备份' 'FAIL 新反馈' 'FAIL 付款' 'FAIL 快照骤缩' 'FAIL 客户端失败'
[[ $(cat "$scratch/state") == "$((now - 100))" ]]
export PROD_TEST_DB="$scratch/empty.sqlite"
printf 'invalid\n' > "$scratch/state"
run_case 2 corrupt-state 'FAIL 状态文件'
[[ $(cat "$scratch/state") == invalid ]]
printf '0000000008\n' > "$scratch/state"
run_case 2 leading-zero-state 'FAIL 状态文件'
[[ $(cat "$scratch/state") == 0000000008 ]]
printf '%s\n' "$((now + 100))" > "$scratch/state"
run_case 2 future-state 'FAIL 状态文件'
[[ $(cat "$scratch/state") == "$((now + 100))" ]]

# 超过 20 个异常仍数全量，但每项明细只给 20 行。
python3 - "$scratch/empty.sqlite" "$now" <<'PY'
import datetime as dt, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
now = dt.datetime.fromtimestamp(int(sys.argv[2]), dt.timezone.utc).isoformat()
db.executemany('INSERT INTO users(id,email,password_hash,password_salt,created_at,last_login) VALUES(?,?,?,?,?,?)',
               [(f'overflow-{i}', f'overflow-{i}', 'fixture', 'fixture', now, now) for i in range(25)])
db.commit()
PY
rm "$scratch/state"
run_case 1 detail-cap 'WARN 云备份 — 25 个'
[[ $(grep -c '^  {"id":"overflow-' "$scratch/detail-cap.out") == 20 ]]
python3 - "$scratch" <<'PY'
import pathlib, sys
for output in pathlib.Path(sys.argv[1]).glob('*.out'):
    if output.name in ('sql.out', 'empty.out', 'payments.out'):
        continue
    count = 0
    for line in output.read_text().splitlines():
        if line.startswith(('OK ', 'WARN ', 'FAIL ', 'SUMMARY ')):
            count = 0
        else:
            assert line.startswith('  '), (output.name, line)
            count += 1
            assert count <= 20, output.name
PY
export PATH=$original_path
printf 'OK integration: single SSH, 0/1/2 exits and summary, journal grouping, disk/backup boundaries, timers, HTTP/SSH/SQL failures, cursor safety and 20-line cap\n'
bash -n "$root/scripts/prod-health.sh" "$root/scripts/prod-health.selftest.sh"
if command -v shellcheck >/dev/null; then
  shellcheck "$root/scripts/prod-health.sh" "$root/scripts/prod-health.selftest.sh"
else
  printf 'SKIP shellcheck: not installed\n'
fi
