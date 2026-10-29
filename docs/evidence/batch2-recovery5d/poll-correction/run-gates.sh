#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/workagent-continuation-20261026
out="$PWD/docs/evidence/batch2-recovery5d/poll-correction"
test ! -e "$out/gates.tsv"
printf 'step\texit\n' > "$out/gates.tsv"
cd web
run() {
  local name="$1"; shift
  set +e
  "$@" > "$out/gate-$name.log" 2>&1
  local rc=$?
  set -e
  printf '%s\t%s\n' "$name" "$rc" >> "$out/gates.tsv"
  if [ "$rc" -ne 0 ]; then printf '%s failed (%s)\n' "$name" "$rc"; exit "$rc"; fi
}
run focused ./node_modules/.bin/vitest run test/poll-scope.test.ts test/scope-races.test.ts
run frontend ./node_modules/.bin/vitest run --reporter=junit --outputFile="$out/frontend.xml"
run typecheck ./node_modules/.bin/tsc --noEmit
run lint ./node_modules/.bin/eslint . --max-warnings 0
run format ./node_modules/.bin/prettier --check .
export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_WORKAGENT_API_BASE=/api/domain
run build node node_modules/next/dist/bin/next build --webpack
printf 'All serial gates passed.\n'
