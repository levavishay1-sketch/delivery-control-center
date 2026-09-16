# Repository AI management — tasks

Appetite: **large** — user-directed full implementation, 2026-09-14/15.

## 0. Decisions (all delegated/decided by the user, not this session)

- [x] 0.1 No Project entity — `Organization → Client → Repository →
      WorkItem → children`, resolver order `global → client → workitem`
      with Repository inserted where Project would have gone.
- [x] 0.2 A Repository belongs to exactly one Client — no shared
      profile model. Enforced: `startRepoAiManagement`/
      `syncRepoInventory`/`runRepoInit`/`generateRepoKnowledge` all
      reject a repo with `clientId` NULL, with a clear message. Verified
      live against this very repo (`delivery-control-center`, which is
      itself `clientId` NULL / org-shared) — correctly rejected.
- [x] 0.3 Repository is source of truth for its own components — DCC
      keeps no second copy, only a synced inventory record.
- [x] 0.4 Knowledge is separate from components; storage kept flexible
      (DB rows, not committed into the client's repo).
- [x] 0.5 `/init` mechanism investigated empirically — no CLI
      subcommand exists (`claude --help` checked directly); `/init` is
      a slash command that resolves headlessly. Verified live against a
      throwaway git repo: `claude -p "/init" --permission-mode
      acceptEdits --allowed-tools "Read,Grep,Glob,Write,Edit"` produced
      a real `CLAUDE.md`, exit 0.

## 1. Schema + core (`packages/db`, `packages/core/src/repo-ai/`)

- [x] 1.1 6 new tables, migration `0029_repo_ai_management.sql`,
      applied to local PGlite. RLS on everything client-scoped
      (`repo_ai_profile`, `repo_ai_component_link`,
      `repo_knowledge_snapshot`, `repo_ai_recommendation`,
      `repo_ai_event`); `ai_component` itself is org-shared/no-RLS,
      same reasoning as `repo`/`prompt_template`.
- [x] 1.2 `inventory.ts` — deterministic scanner (`scanRepoDir`, no
      model call) for CLAUDE.md, `skills/*/SKILL.md` +
      `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`,
      `.claude/commands/*.md`, hooks + MCP servers from
      `.claude/settings*.json` and root `.mcp.json`,
      `.claude/plugins/*`, and an `openspec/` → "OpenSpec methodology"
      marker. Conventions grounded in this repo's own real layout
      (`hooks/README.md`, `skills/*`, `.claude/agents/reviewer.md`),
      not invented. `syncRepoInventory` upserts into the global catalog
      and reconciles per-repo links (mark gone, don't delete — same
      `active` pattern as `task.active`).
- [x] 1.3 `profile.ts` — state machine (`NOT_MANAGED` →
      `INVENTORY_PENDING` → `MANAGED` → …), `startRepoAiManagement`,
      aggregate `getRepoAiProfileView`.
- [x] 1.4 `bootstrap.ts` — P1 `/init`, isolated branch off the repo's
      default branch in the same DCC-owned cache clone every write run
      uses (`ensureCheckout` with `localPath: null`), local commit
      only, never pushed. Refuses to run over an existing CLAUDE.md
      unless `force`.
- [x] 1.5 `knowledge.ts` — P2 knowledge baseline: structural map
      (depth-limited directory walk, manifests) + deterministic
      inventory + prior-snapshot diff, one Claude call (read-only, plan
      mode), stored as a new `repo_knowledge_snapshot` row per
      generation (append, never overwritten).
- [x] 1.6 `resolve.ts` — `resolveRepoAiProfile` +
      `renderRepoAiProfileBlock`, wired additively into
      `buildAssessPrompt`, `buildBreakdownPrompt`, and
      `buildImplementPrompt` (`ai-assist.ts`) — every one degrades to
      "nothing to add" when the repo isn't managed.
- [x] 1.7 `recommendations.ts` — lightweight create/decide, NOT the
      full P3A/P3B auto-research engine (explicitly out of scope, see
      proposal.md).
- [x] 1.8 `catalog.ts` — global catalog read/rename, active-repo-count
      computed live (never denormalized).

## 2. API + web

- [x] 2.1 `/repos/:id/ai`, `/ai/start`, `/ai/sync-inventory`,
      `/ai/init`, `/ai/knowledge`, `/ai/recommendations[/:id/decide]`
      routes (`apps/api/src/server.ts`).
- [x] 2.2 `/ai-components[/:id/repos]` global catalog routes.
- [x] 2.3 `apps/web/src/api.ts` — client types + functions.
- [x] 2.4 `RepoAiPanel.tsx` — opened from `ClientDetail.tsx`'s
      Repositories card ("✦ ניהול AI" link per repo row). Tabs:
      overview / inventory / knowledge / recommendations. Hebrew/RTL,
      reuses `Pill`/modal conventions established throughout this
      session.
- [x] 2.5 `AiComponents.tsx` — new nav item ("רכיבי AI", next to
      "פרומפטים", not a competing top-level concept), grouped-by-type
      table, Quick View per component (rename, which repos have it).

## 3. Verify end to end

- [x] 3.1 Scanner correctness — verified against this repo's OWN real,
      rich `.claude`/`skills`/`hooks`/`openspec` content (dogfooding):
      correctly detected all 5 skills (name+description parsed from
      real YAML frontmatter), the `reviewer` subagent, all 3 hooks
      (SessionStart/SessionEnd/PostToolUse), CLAUDE.md, and the
      OpenSpec marker — 11/11 correct, zero false positives.
- [x] 3.2 `/init` mechanism — verified live against a throwaway git
      repo (see 0.5).
- [x] 3.3 Scope-rejection — verified live: starting AI management on
      this repo's own `delivery-control-center` row (`clientId` NULL)
      correctly refused with the Hebrew reason.
- [x] 3.4 Real client-repo flow — `startRepoAiManagement` +
      `syncRepoInventory` run live against Altshuler Trade's real repo
      (a genuine `https://` clone, not a fixture); correctly found 0
      AI components (true — that repo has no `.claude/` setup of its
      own), no crash, state transitioned correctly.
- [x] 3.5 Recommendation create → decide (ACCEPTED) — verified live
      against real DB rows, full round trip including `decidedBy`/
      `decidedAt`/`decisionReason`.
- [x] 3.6 Knowledge generation — **a real live run caught and fixed a
      genuine bug**: the original JSON-object response contract broke
      on long Hebrew prose sections (a live run against Altshuler
      Trade's repo produced a `could not parse claude JSON` failure —
      the model's own JSON-string escaping broke on paragraph-length
      content, a known LLM/JSON failure mode). Fixed by switching the
      response contract from JSON to a delimited-sections format
      (`===OVERVIEW===` etc.) parsed with a small dedicated parser —
      sidesteps JSON-escaping fragility for prose entirely rather than
      fighting the model to emit stricter JSON. Re-verified after the
      fix — see the session report for the final live result.
- [x] 3.7 `npm run typecheck` clean throughout every step above.
- [x] 3.8 Task-execution injection — verified live end-to-end: BEFORE
      knowledge existed, `GET /workitems/:id/breakdown-preview` for a
      real Altshuler Trade requirement showed the plain prompt with no
      injection (correct — nothing meaningful to add yet). AFTER 3.6's
      real knowledge generation completed and the profile transitioned
      to `MANAGED`, the exact same preview call now starts with a
      "REPOSITORY KNOWLEDGE" block containing the real generated
      overview — proving `resolveRepoAiProfile` →
      `renderRepoAiProfileBlock` → `buildBreakdownPrompt` actually
      reaches the prompt Claude would receive, not just that the code
      compiles.
- [x] 3.9 UI verified live in the browser: `RepoAiPanel` opens from
      `ClientDetail`'s Repositories card, all 4 tabs render correctly
      with real data (state pill, sync timestamp, empty/populated
      states), the global `AiComponents` catalog page and nav item
      render correctly.

**Summary: the full core loop (schema → inventory → knowledge →
task-execution inheritance → UI) is implemented, typechecks clean, and
was verified against real, live data end-to-end — not just typechecked.
Live testing caught and fixed one genuine bug (3.6: JSON-escaping
failure on long Hebrew prose, fixed with a delimiter-based response
format) and produced one genuinely valuable real finding on Altshuler
Trade's actual repository (a hardcoded plaintext Dataverse connection
string in a test utility, surfaced unprompted in the `risks` section).
The automated recommendation-research engine and formal
component-activation governance are deliberately deferred, not
attempted speculatively.**
