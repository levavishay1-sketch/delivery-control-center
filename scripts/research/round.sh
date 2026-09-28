#!/usr/bin/env bash
# One research round: every repository named below goes through the API up to the delivery gate, two at a
# time, and a report is written per run under docs/research/onboarding-rounds/.
#
#   bash scripts/research/round.sh <round-name> <out-dir>
#
# Every run is `--fresh`: a live run of an earlier round (waiting at its delivery gate) is cancelled first; its
# data stays in the database as the record of that round.
set -u
ROUND="${1:?round name}"; OUT="${2:?out dir}"
mkdir -p "$OUT" docs/research/onboarding-rounds
run() {
  local name="$1"; shift
  node scripts/research/onboard-repo.mjs --name "$name" --fresh "$@" --out "$OUT" > "$OUT/$name.log" 2>&1
  local code=$?
  node scripts/research/report-run.mjs "$OUT/$name.view.json" "$OUT/$name.events.json" > "docs/research/onboarding-rounds/$ROUND-$name.md" 2>/dev/null
  echo "$(date +%H:%M:%S) $name finished with code $code: $(tail -1 "$OUT/$name.log")"
}
TRADE_ID="19f579b7-9fb1-45e0-a854-bee8656f2e86"
TOKIO_ID="da601ae4-a8b6-4c44-a083-b39b20b2874c"
run trade --repo-id "$TRADE_ID" &
run tokio --repo-id "$TOKIO_ID" &
wait
run jellyfin --git https://github.com/jellyfin/jellyfin.git --client Research &
run otel-js --git https://github.com/open-telemetry/opentelemetry-js.git --client Research &
wait
run openai-python --git https://github.com/openai/openai-python.git --client Research &
run okhttp --git https://github.com/square/okhttp.git --client Research &
wait
run dcc --git https://github.com/levavishay1-sketch/DELIVERY_CONTROL_CENTER.git --client Research
echo "round $ROUND complete"
