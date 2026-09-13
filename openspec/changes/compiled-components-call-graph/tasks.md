# Compiled components — call-graph analysis — tasks

Appetite: **small** (a prompt rewrite, same shape as the previous fix).

- [x] 1.1 Rewrite the `compiledComponents` instructions in
      `buildBreakdownPrompt` (`packages/core/src/ai-assist.ts`, ~line
      603) to specify the function-level call-graph walk (changed
      function → callers → callers of callers → root callers/entry
      points → projects containing those roots), replacing the
      project-reference-level instructions from the previous round
- [x] 1.2 Included the `X → B → C → D → EntryPoint` worked example
      verbatim, plus the "why not just the BL project" framing
- [ ] 1.3 Verify live: re-run breakdown on the same recurring test task
      (`AuthorizationManagementBL.cs` / `ResolveManagerBackControlWorkflow`)
      and confirm `compiledComponents` lists the actual root-caller
      project(s) — **not run yet**, since it's a real, costed `claude
      -p` invocation against the repo and wasn't explicitly asked for;
      ready whenever a breakdown re-run happens (by the user, or on
      request)
- [x] 1.4 `npm run typecheck` clean (prompt-only change, verified
      nothing else broke)
