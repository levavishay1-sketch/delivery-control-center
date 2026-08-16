## 1. Component

- [ ] 1.1 Create `src/components/ui/InfoTooltip.tsx`: a controlled disclosure — an "ⓘ" trigger
      `<button>` (`aria-label`, `aria-expanded`, `aria-controls`) plus a floating-elevation panel
      (design-system's floating token — shadow, no backdrop dimming) rendering a `label` heading
      and `children` body. Opens on click/Enter/Space/hover; closes on Escape, click-outside, or
      mouse-leave-without-a-prior-click.
- [ ] 1.2 Position the panel `absolute` relative to an inline wrapping span around the trigger, per
      design.md's no-portal decision. Use logical CSS properties (`text-start`, `ms-*`/`me-*`) so
      it mirrors correctly under RTL without a separate variant.
- [ ] 1.3 Respect `prefers-reduced-motion` for the open/close transition, matching the existing
      convention in `globals.css`'s reduced-motion block (Slice 9).

## 2. Adoption site

- [ ] 2.1 Add one `InfoTooltip` usage next to the AI Budget field rendered by
      `ConfigBudgetPanel`/the Configuration Center page, explaining what the effective budget
      value means and how inheritance/override determines it (proposal.md's Impact section).
      Budget logic itself is unchanged.

## 3. Tests

- [ ] 3.1 Unit test: `InfoTooltip` opens/closes via click, keyboard (Enter/Space to open, Escape to
      close), and closes on outside click; `aria-expanded` reflects state.
- [ ] 3.2 Extend the existing RTL E2E spec (`e2e/slice8-i18n-rtl.spec.ts`) with a step verifying
      the new AI Budget `InfoTooltip` mirrors correctly under RTL (position relative to the field,
      readable popover content) — following that file's established pattern of appending
      slice-specific RTL checks rather than a new spec file.
- [ ] 3.3 Add or extend an E2E scenario opening the AI Budget `InfoTooltip` via keyboard only (no
      mouse), confirming the explanation becomes visible — proves the design-system requirement's
      "reachable without a mouse" scenario end-to-end, not just at the unit level.

## 4. Documentation & verification

- [ ] 4.1 Run `/verify` (build + lint + a live check): load the Configuration Center's AI Budget
      field in a running dev server, confirm the ⓘ opens/closes correctly by mouse, keyboard, and
      (if feasible to check) touch emulation; spot-check RTL.
- [ ] 4.2 Update `docs/ROADMAP.md`'s Slice 11 row and detail section to **Done**, linking this
      change's archive path, following the same pattern as Slices 0–10.
