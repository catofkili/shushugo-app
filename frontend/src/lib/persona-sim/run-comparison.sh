#!/usr/bin/env bash
# nohup bash src/lib/persona-sim/run-comparison.sh >> .local/persona-sim/compare-2026-11-05/driver.log 2>&1 < /dev/null &
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
sim_root="${PERSONA_SIM_COMPARE_ROOT:-$PWD/.local/persona-sim/compare-2026-11-05}"
sim_frozen="${SHUSHUGO_LIVE_DB:-$PWD/.local/persona-sim-frozen-2026-11-03.db}"
[[ "$sim_root" = /* && "$sim_frozen" = /* ]]
mkdir -p "$sim_root"
export SHUSHUGO_LIVE_DB="$sim_frozen" npm_config_offline=true
export PERSONA_SIM_SEEDS=20 PERSONA_SIM_PARALLEL="${PERSONA_SIM_PARALLEL:-2}"
export PERSONA_SIM_CHILD_TIMEOUT_MS="${PERSONA_SIM_CHILD_TIMEOUT_MS:-7200000}"
unset PERSONA_SIM_SMOKE PERSONA_SIM_RANGE PERSONA_SIM_BATCH PERSONA_SIM_COMPARE PERSONA_SIM_LIGHT_FIXTURE
# 先取得轻人设的成对结果；self仍完整跑60天，未因它慢而截短。
for sim_id in zero cram cram-lock office break fast struggle light self; do
  for sim_policy in current budget; do
    export SHUSHUGO_PERSONA_SIM=1 PERSONA_SIM_IDS="$sim_id" PERSONA_SIM_POLICY="$sim_policy"
    export PERSONA_SIM_OUTPUT="$sim_root/$sim_policy"
    sim_log="$sim_root/$sim_policy-$sim_id.log"
    date -u '+%Y-%m-%dT%H:%M:%SZ'
    echo "START $sim_policy $sim_id 20 seeds"
    # 续跑和最终缓存核验都保留此前日志，避免把完整长跑记录覆盖成几行缓存命中。
    if ./node_modules/.bin/vitest run src/lib/persona-sim/persona-load-simulation.test.ts --configLoader runner --no-cache --maxWorkers 1 >> "$sim_log" 2>&1; then
      echo "PASS $sim_policy $sim_id exit=0"
    else
      sim_code=$?
      echo "FAIL $sim_policy $sim_id exit=$sim_code; see $sim_log; rerun this script to resume saved seeds"
      exit "$sim_code"
    fi
  done
done
unset SHUSHUGO_PERSONA_SIM
export PERSONA_SIM_COMPARE="$sim_root/current,$sim_root/budget"
export PERSONA_SIM_COMPARE_OUT="$PWD/../docs/audits/2026-11-05-budget-sim-compare.md"
./node_modules/.bin/vitest run src/lib/persona-sim/persona-load-simulation.test.ts --configLoader runner --no-cache --maxWorkers 1
echo "COMPLETE exit=0"
