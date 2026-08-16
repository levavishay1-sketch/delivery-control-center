#!/usr/bin/env bash
# Fails CI when a diff *creates* a new file in a location that is
# inherently "new capability" shaped — a Prisma migration, an API route,
# a domain module, or a top-level page — with no accompanying openspec/
# path in the same diff.
#
# Deliberately narrow: this only looks at newly-added files, never at
# edits to existing ones. A label tweak, a button change, a CSS
# adjustment, or a bug fix touches only existing files and never trips
# this, no matter how large the diff — those are the "small, local,
# obvious" changes CLAUDE.md's OpenSpec rule exempts. Only the shape of
# adding a new migration/route/domain-module/page is treated as a signal
# that the work is meaningful enough to warrant OpenSpec's planning
# artifacts. This is a deliberately weaker, false-positive-averse proxy
# for "meaningful work" — it will not catch a spec being silently
# contradicted by an edit to an existing file; that's a judgment call
# left to CLAUDE.md's "spec-anchored, not spec-once" rule, not something
# a diff can mechanically prove.
set -euo pipefail

if [ "${EVENT_NAME:-}" = "pull_request" ]; then
  git fetch --no-tags --depth=50 origin "${BASE_REF:?}" >/dev/null 2>&1 || true
  BASE="origin/${BASE_REF}"
elif [ "${EVENT_NAME:-}" = "push" ] && [ -n "${BEFORE_SHA:-}" ] && [ "${BEFORE_SHA}" != "0000000000000000000000000000000000000000" ] && git cat-file -e "${BEFORE_SHA}" 2>/dev/null; then
  BASE="${BEFORE_SHA}"
else
  echo "No comparable base commit (e.g. first push of a branch) — skipping OpenSpec compliance check."
  exit 0
fi

# Only newly-added files (status A) — edits to existing files never trip this check.
ADDED="$(git diff --name-status --diff-filter=A "${BASE}...HEAD" | cut -f2)"

if [ -z "${ADDED}" ]; then
  echo "No newly-added files — OpenSpec change not required."
  exit 0
fi

NEW_CAPABILITY_SIGNAL="$(echo "${ADDED}" | grep -E '^(prisma/migrations/.+/migration\.sql$|src/app/api/.*/route\.ts$|src/domain/.+\.ts$|src/app/.*/page\.tsx$)' || true)"

if [ -z "${NEW_CAPABILITY_SIGNAL}" ]; then
  echo "No new-capability-shaped files added (migration/API route/domain module/page) — OpenSpec change not required."
  exit 0
fi

CHANGED="$(git diff --name-only "${BASE}...HEAD")"
OPENSPEC_TOUCHED="$(echo "${CHANGED}" | grep -E '^openspec/' || true)"

if [ -n "${OPENSPEC_TOUCHED}" ]; then
  echo "New capability files are accompanied by an OpenSpec change/spec update. OK."
  exit 0
fi

cat <<EOF
::error::New capability-shaped file(s) added with no matching OpenSpec change or spec update.

New files that triggered this:
${NEW_CAPABILITY_SIGNAL}

Per CLAUDE.md, meaningful development work — new migrations, API routes,
domain modules, or pages — must go through OpenSpec (a folder under
openspec/changes/ with proposal.md, a specs/ delta, design.md, and
tasks.md — archived and synced to openspec/specs/ on completion).

If this is genuinely a small, local, obvious addition that doesn't warrant
planning artifacts, say so explicitly in the PR description rather than
bypassing this check — this gate errs on the side of asking, not blocking.
EOF
exit 1
