# Onboarding — adaptive deny-rule suggestions, fixed security profile — tasks

Appetite: **small**.

## 1. Stage 04 (`security_permissions`)

- [x] 1.1 `packages/core/src/repo-onboarding/seed-prompts.ts` — new
      prompt `onboarding.security_deny_rules_suggest`: given the
      deterministic scan's baseline rules + repo scan summary +
      classification, explore the real workspace checkout and return
      `{"additional_rules": [{"pattern", "reason"}]}` for repo-specific
      finds the fixed junk-dir/extension list wouldn't catch. Explicit
      "do not repeat the baseline" / "do not guess" / empty-list-is-valid
      constraints, same discipline as the other evaluation prompts.
- [x] 1.2 `stages/security-permissions.ts` — kept the free deterministic
      scan as the baseline (unchanged), added one `read_only_plan` Claude
      call seeded with the baseline as its own `denyRules` (so the
      exploratory call can't fall into the trap it's looking for more
      of), merged + deduped with the baseline. A parse failure on the
      Claude side degrades to "no additional suggestions", never fails
      the stage — the deterministic baseline alone is still a complete,
      correct answer.
- [x] 1.3 Removed the security-profile picker entirely: `security-
      profiles.ts`'s `suggestSecurityProfile()` heuristic deleted (no
      other callers), stage now always resolves the fixed
      `FIXED_SECURITY_PROFILE_ID = "STANDARD_DEVELOPMENT"`. Catalog file
      and `resolveEffectivePolicy`/`getSecurityProfile` untouched — stage
      11 (`guardrails`) still needs one resolved profile.
- [x] 1.4 `resumeInput` (approval) branch simplified to take only
      `approvedRules`; always attaches the fixed profile id when building
      `effectivePolicy`. `stages/guardrails.ts` needed no change — it
      only ever read `approvedRules`/`approvedProfileId`, both still
      produced.

## 2. UI — `RepoOnboardingPanel.tsx`

- [x] 2.1 Removed the profile radio-picker block and its `selectedProfileId`
      state; `SuggestedRules` type trimmed to `{suggestedRules}`.
- [x] 2.2 `submitOnboardingStageInput` call for this stage no longer
      sends `approvedProfileId`.
- [x] 2.3 Rewrote the stage's "what happens now" explanatory copy (was
      describing a profile choice and "no AI analysis needed", both now
      false).

## 3. Verify

- [x] 3.1 `npm run typecheck` — clean, whole repo.
- [x] 3.2 Re-ran `seed-prompts.ts` locally — new prompt key created,
      the 12 pre-existing ones correctly left untouched (idempotent).
- [x] 3.3 Not yet exercised end-to-end against a real repo checkout in
      this session (no repo registered in this environment to onboard) —
      deferred to the next real onboarding run.
