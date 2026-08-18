## 1. Component

- [x] 1.1 Create `src/components/ui/InfoTooltip.tsx`: a controlled disclosure — an "ⓘ" trigger
      `<button>` (`aria-label`, `aria-expanded`, `aria-controls`) plus a floating-elevation panel
      (design-system's floating token — shadow, no backdrop dimming) rendering a `label` heading
      and `children` body. Opens on click/Enter/Space/hover; closes on Escape, click-outside, or
      mouse-leave-without-a-prior-click.
- [x] 1.2 Position the panel `absolute` relative to an inline wrapping span around the trigger, per
      design.md's no-portal decision. Use logical CSS properties (`text-start`, `ms-*`/`me-*`) so
      it mirrors correctly under RTL without a separate variant.
- [x] 1.3 Respect `prefers-reduced-motion` for the open/close transition, matching the existing
      convention in `globals.css`'s reduced-motion block (Slice 9). Reused the existing
      `.animate-fade-up` utility (already gated in that block) rather than adding a new one.

## 2. Adoption site

- [x] 2.1 Add one `InfoTooltip` usage next to the AI Budget field rendered by
      `ConfigBudgetPanel`/the Configuration Center page, explaining what the effective budget
      value means and how inheritance/override determines it (proposal.md's Impact section).
      Budget logic itself is unchanged.

## 3. Tests

- [x] 3.1 Unit test: `InfoTooltip` opens/closes via click, keyboard (Enter/Space to open, Escape to
      close), and closes on outside click; `aria-expanded` reflects state. **Resolved as
      intentionally not done** — user chose "skip for now" when asked, given this project has no
      component-testing infrastructure (see note below) and the E2E coverage in 3.2/3.3 already
      exercises the same open/close/keyboard/aria-expanded behavior against a real browser.
      Standing up `@testing-library/react`/jsdom is deferred to its own future decision, not
      bundled into this slice.
- [x] 3.2 Extend the existing RTL E2E spec (`e2e/slice8-i18n-rtl.spec.ts`) with a step verifying
      the new AI Budget `InfoTooltip` mirrors correctly under RTL (position relative to the field,
      readable popover content) — following that file's established pattern of appending
      slice-specific RTL checks rather than a new spec file.
- [x] 3.3 Add or extend an E2E scenario opening the AI Budget `InfoTooltip` via keyboard only (no
      mouse), confirming the explanation becomes visible — proves the design-system requirement's
      "reachable without a mouse" scenario end-to-end, not just at the unit level. Added
      `e2e/slice11-info-tooltip.spec.ts`.

**Note on 3.1**: this project has no component-level unit-testing infrastructure today — `vitest.config.ts`
runs with `environment: "node"` and the entire existing unit suite (300 tests) covers the domain
layer only (`*.commands.test.ts`/`*.queries.test.ts`); zero `*.test.tsx` files and no
`@testing-library/react`/jsdom-or-happy-dom dependency exist in this codebase. Writing this task as
specified requires standing up new test infrastructure (a new dependency, a new Vitest
`environment`, possibly `npm install-scripts approve` per CLAUDE.md's gotcha) — real, cross-cutting
scope this change's design.md never named as a decision. Per the apply workflow's guardrails, this
is surfaced rather than silently absorbed (skipped, or infra added unilaterally). Task 3.3's E2E
coverage already exercises the same open/close/keyboard/aria-expanded behavior this unit test would
check, against the real browser DOM rather than a simulated one — paused for the user's call on
whether that's sufficient for this component, or whether to add the component-testing stack now.

## 4. Documentation & verification

- [x] 4.1 Ran `/verify`: `npm run lint` and `npm run build` both clean. Live-checked in a running
      dev server against the Configuration Center's AI Budget field: mouse hover opens it and
      closes on mouse-away (screenshotted); click pins it open (`aria-expanded="true"`,
      screenshotted); keyboard-only Enter/Space/Escape confirmed end-to-end by
      `e2e/slice11-info-tooltip.spec.ts`; RTL mirroring confirmed by the extended
      `e2e/slice8-i18n-rtl.spec.ts` step. No touch-emulation check performed (Playwright touch
      emulation wasn't exercised) — the component's interaction model doesn't distinguish touch
      from click, so this is a low-risk gap, noted rather than silently claimed as covered.
- [x] 4.2 Updated `docs/ROADMAP.md`'s Slice 11 row and detail section to **Done**, linking
      `openspec/changes/info-tooltip-primitive/` (not yet archived — same pattern as other
      recently-completed slices, pending an explicit archive request).
