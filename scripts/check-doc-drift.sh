#!/usr/bin/env bash
# Doc-drift guard: asserts that counts and claims in README.md / docs/ match
# the source tree. Invoked by .github/workflows/doc-drift.yml — always call
# with `bash scripts/check-doc-drift.sh` (this file is mode 100644 upstream,
# not executable). A failure means a doc claim went stale — fix the doc, or
# the code if the code is what actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# 1. Migration count matches the README architecture tree.
actual_migrations=$(ls packages/worker/migrations/*.sql | wc -l | tr -d ' ')
grep -q "${actual_migrations} D1 migrations" README.md \
  || fail "README.md migration count drift. Actual: ${actual_migrations}"

# 2. Zustand store count matches the README architecture tree.
actual_stores=$(ls packages/web/src/stores/use*Store.ts | wc -l | tr -d ' ')
grep -q "${actual_stores} Zustand stores" README.md \
  || fail "README.md Zustand store count drift. Actual: ${actual_stores}"

# 3. routes/s3.ts stays fully migrated to the repository pattern (0 inline SQL).
s3_inline=$(grep -c '\.prepare(' packages/worker/src/routes/s3.ts || true)
[ "${s3_inline}" = "0" ] \
  || fail "routes/s3.ts has ${s3_inline} inline .prepare() calls — README says fully migrated"

# 4. No references to the removed `activeSyncs` Set (replaced by the D1
#    sync_state lock). Backticked form only — that is the exact drift marker;
#    other prose spellings are historical narrative, not live claims.
if grep -rn '`activeSyncs` Set' README.md docs/ .env.example 2>/dev/null; then
  fail "doc references the removed \`activeSyncs\` Set (replaced by the D1 sync_state lock)"
fi

echo "OK: no doc drift."
