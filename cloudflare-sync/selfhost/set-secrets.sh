#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run with sudo: sudo /opt/shushugo/cloudflare-sync/selfhost/set-secrets.sh" >&2
  exit 1
fi

file=/etc/shushugo/worker.env
install -d -o root -g root -m 0700 /etc/shushugo
declare -A values prompt_keys
keys=(
  APP_STORE_ISSUER_ID APP_STORE_KEY_ID APP_STORE_PRIVATE_KEY
  RESEND_API_KEY EMAIL_FROM TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY
  WECHAT_APP_ID WECHAT_APP_SECRET WECHAT_MOBILE_APP_ID WECHAT_MOBILE_APP_SECRET
  WECHAT_MSG_TOKEN WECHAT_PAY_APP_KEY WECHAT_PAY_SANDBOX_APP_KEY WECHAT_PAY_PRODUCTION_APP_KEY
)
for key in "${keys[@]}"; do prompt_keys["$key"]=1; done

required_for() {
  case "$1" in
    TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|RESEND_API_KEY|EMAIL_FROM) echo "required for production auth hardening" ;;
    APP_STORE_ISSUER_ID|APP_STORE_KEY_ID|APP_STORE_PRIVATE_KEY) echo "required for Apple purchase verification" ;;
    WECHAT_APP_ID|WECHAT_APP_SECRET) echo "required for Mini Program login/content security" ;;
    WECHAT_MOBILE_APP_ID|WECHAT_MOBILE_APP_SECRET) echo "required for WeChat mobile-app login" ;;
    WECHAT_MSG_TOKEN) echo "required for WeChat payment notifications" ;;
    WECHAT_PAY_APP_KEY|WECHAT_PAY_SANDBOX_APP_KEY|WECHAT_PAY_PRODUCTION_APP_KEY) echo "configure the key matching WECHAT_PAY_ENV" ;;
    *) echo optional ;;
  esac
}

if [[ -f $file ]]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    values["$key"]=$value
  done < "$file"
fi

for key in "${keys[@]}"; do
  if [[ -n ${values[$key]:-} ]]; then state='configured; Enter keeps it'; else state='blank; Enter leaves empty'; fi
  printf '%s (%s; %s, CLEAR removes): ' "$key" "$(required_for "$key")" "$state" >/dev/tty
  value=''
  IFS= read -r -s value </dev/tty || true
  printf '\n' >/dev/tty
  if [[ -n $value ]]; then
    if [[ $value == CLEAR ]]; then unset 'values[$key]'; else values["$key"]=$value; fi
  fi
done

tmp=$(mktemp /etc/shushugo/worker.env.XXXXXX)
trap 'rm -f "$tmp"' EXIT
for key in "${!values[@]}"; do
  [[ ${prompt_keys[$key]:-} ]] && continue
  printf '%s=%s\n' "$key" "${values[$key]}" >> "$tmp"
done
for key in "${keys[@]}"; do
  [[ ${values[$key]+yes} ]] && printf '%s=%s\n' "$key" "${values[$key]}" >> "$tmp"
done
chown root:root "$tmp"
chmod 0600 "$tmp"
mv -f "$tmp" "$file"
trap - EXIT
echo "Saved /etc/shushugo/worker.env (root:root 0600). Restart with: sudo systemctl restart shushugo-worker"
