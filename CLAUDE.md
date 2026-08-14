@AGENTS.md

## Git workflow

Routine git operations are pre-authorized — do them without asking for
per-action approval: `git add`, `git commit`, creating/switching local
branches, `git pull`, and `git push` to non-`main` branches.

Commit at natural checkpoints: after an OpenSpec change is archived (bundle
the code changes, the updated `openspec/specs/`, and the archived change
folder into one commit), or after any other coherent unit of work is
verified working (build/lint pass, manually checked). Write commit messages
that explain why, matching this repo's existing message style once one is
established.

Still confirm first, every time: force-push (`push --force`), `git reset
--hard`, rewriting published history, deleting branches, and pushing
directly to `main` (open a PR instead once a remote exists, unless told
otherwise).
