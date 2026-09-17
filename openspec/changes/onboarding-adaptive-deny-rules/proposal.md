# Onboarding — Adaptive Deny-Rule Suggestions, Fixed Security Profile

Appetite: **small**

## Why

Stage 04 (`security_permissions`) of the repository onboarding pipeline
(`repository-ai-enablement`) currently suggests `Read` deny rules purely
from a deterministic filesystem scan against a fixed, hardcoded list of
junk directory names and binary extensions (`bin`, `obj`, `node_modules`,
`.dll`, ...). That list is precise but not adaptive: it only catches what
someone already thought to hardcode. The exact failure mode this stage
exists to prevent — Altshuler Trade's `packages/` folder holding ~970
vendored `.dll`/`.pdb` files under a directory name nobody had reason to
blocklist — was only found by a human live-testing one specific repo and
then patched into the fixed list by hand. Nothing catches the next
repo-specific surprise before it burns a Claude run's cost/turns reading
build output.

Separately, the stage also asks the human to pick one of 5 named security
profiles (`STANDARD_DEVELOPMENT`, `RESTRICTED`, `READ_ONLY`, `SANDBOX`,
`INFRASTRUCTURE`) via a suggested/overridable radio choice. Confirmed with
the user (2026-09-17): this choice is unwanted complexity — the profile is
always the same in practice, so the picker and the suggestion heuristic
behind it should go, not just be hidden.

## What changes

- **Security profile is now fixed**, not suggested/chosen: the stage
  always resolves `STANDARD_DEVELOPMENT` as `approvedProfileId`. The radio
  picker UI, `suggestSecurityProfile()`, and the profile catalog embedded
  in the stage result are removed. `config/security-profiles.json` and
  `resolveEffectivePolicy`/`getSecurityProfile` stay — stage 11
  (`guardrails`) still needs a resolved profile, just no longer a chosen
  one.
- **Deny-rule suggestions gain a second, adaptive source**: alongside the
  existing free, deterministic scan-based list, the stage now makes one
  Claude call (`read_only_plan`, against the real onboarding workspace
  checkout) asking it to look for additional directories/files worth
  denying that the fixed list wouldn't catch — vendored dependencies under
  a non-standard folder name, repo-specific generated code, anything else
  a human reviewing the repo would flag. Claude's suggestions are
  additional to, never a replacement for, the deterministic list (which
  stays free and 100% accurate for what it does cover). Both are merged
  (deduped by pattern) into one editable list, same approve/edit/remove
  UX as today — nothing is ever applied without human approval.
- Net cost: one additional Claude call per onboarding run (the pipeline
  already makes ~10+), not per session/turn.

## Explicitly out of scope

- Any change to the deterministic scanner (`scanner.ts`) itself, or its
  fixed junk-dir/extension list — it remains the free, always-correct
  baseline.
- Any change to `guardrails` (stage 11) or the `.claude/settings.json`
  write it produces — it already only needs `approvedRules` +
  `approvedProfileId`, both still produced here.
- Re-litigating the 5-profile catalog's content — only whether the
  onboarding UI lets a human choose among them.

## Impact

- `packages/core/src/repo-onboarding/stages/security-permissions.ts` —
  add the Claude call, drop profile suggestion.
- `packages/core/src/repo-onboarding/security-profiles.ts` — remove
  `suggestSecurityProfile`.
- `packages/core/src/repo-onboarding/seed-prompts.ts` — one new prompt,
  `onboarding.security_deny_rules_suggest`.
- `apps/web/src/screens/RepoOnboardingPanel.tsx` — remove the profile
  radio picker from the `security_permissions` approval block.
