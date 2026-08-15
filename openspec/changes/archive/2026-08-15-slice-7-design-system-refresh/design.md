## Context

Current styling is inline Tailwind utility classes with no shared tokens:
borders as `border-black/10 dark:border-white/15`, hierarchy via `opacity-*`
tricks rather than a type scale, one incidental color (`emerald-500`) for
the "all clear" state, `rounded-lg border p-4` reused for both cards and
list rows, and no icon set. Dark mode currently works via Tailwind's `dark:`
variant pairs written ad hoc per element. See `proposal.md` for the "why."

Per the master prompt's protected constraints (`AGENTS.md`/master-prompt
§1.7), the stack is fixed (Tailwind v4, no new UI component library without
separate approval) — this design stays inside Tailwind's token system
rather than adopting shadcn/Radix/MUI/etc.

## Goals / Non-Goals

**Goals:**
- One tokens source (Tailwind v4 `@theme` block in `globals.css`) for
  color, type scale, spacing baseline, and the two elevation levels, so
  every component pulls from the same values instead of hardcoded hex/
  opacity.
- A small set of shared components (`StatusBadge`, `Row`, `Panel`,
  navigation rail) that encode the design-system spec's rules structurally
  (e.g., `StatusBadge` has a required `reason` prop) rather than relying on
  developer discipline per screen.
- Dark mode continues to work — tokens are defined for both light and dark,
  not retrofitted later.
- Restyle exactly three surfaces end to end (Dashboard, Attention Center,
  Quick View drawer) plus the 360° Record tab shell, proving the token
  system works under real data density before it spreads further.

**Non-Goals:**
- No new routes, no merging `/` and `/attention` (deferred — proposal.md).
- No new domain data, no schema/migration changes, no API changes.
- No third-party component library.
- No restyle of pipeline detail, constitution, config panels, or audit
  trail pages in this slice — later slices apply the now-proven tokens
  there.
- No Ctrl+K palette, no critical-path UI, no WCAG audit — separate,
  already-identified follow-up items (ROADMAP.md).

## Decisions

**Tokens via Tailwind v4 `@theme`, not a JS theme object or CSS-in-JS.**
Tailwind v4's `@theme` directive in `globals.css` lets custom tokens
(`--color-accent`, `--color-status-blocked`, etc.) become real Tailwind
utility classes (`bg-accent`, `text-status-blocked`) with zero extra
tooling, matching the existing "Tailwind utility classes directly in
components, no separate CSS" convention. Alternative considered: a
TypeScript token object consumed via `style=` — rejected, since it can't
generate Tailwind utilities and would fragment styling into two systems.

**Five status colors + one neutral scale + one accent, defined once.**
Matches the master prompt's own semantic palette (green/blue/purple/amber/
red) and the design direction's "one accent, used only for actions."
Neutral scale uses real gray steps (not `black/opacity`) so contrast is
predictable and auditable for the (separately tracked) WCAG follow-up.

**`StatusBadge` requires a `reason` prop at the TypeScript level.**
Enforces the design-system spec's "status without a reason is rejected"
requirement at compile time, not by convention — the prop is required, not
optional, so a screen omitting it fails to build rather than silently
shipping an unexplained status.

**Exactly two elevation levels, expressed as two fixed class strings
(`flat`/`floating`), not a numeric shadow scale.** A numeric scale (e.g.,
`elevation-1` through `elevation-4`) invites exactly the drift into a third
"slightly raised" style the design direction warns against; two named,
fixed treatments make the constraint self-enforcing.

**Icon set: Lucide.** Tree-shakeable, matches Vercel/Linear's stylistic
family cited as references, permissively licensed, common in the Next.js
ecosystem — lowest-friction choice that doesn't require the disallowed
component-library approval (it's icons, not a component system).

**Left icon rail replaces the current inline text-link nav, implemented as
a persistent element in `layout.tsx`.** Matches the design direction's
navigation recommendation directly; kept as a plain Tailwind/flex
implementation (no new dependency).

## Risks / Trade-offs

- **[Risk] Restyling Dashboard/Attention/Quick View touches
  well-tested, working UI** → Mitigation: this is a pure presentation
  change — component props, data fetching, and business logic are
  untouched; existing Playwright E2E specs (`slice1-*`, `slice3-*`, etc.)
  assert on functional selectors (roles, text content, links) already, per
  their own history of surviving prior UI changes (see Slice 6's fix to
  `slice3-budget-enforcement.spec.ts`). Re-run the full E2E suite after
  this slice and fix any selector drift the same way, rather than treating
  a broken selector as a functional regression.
- **[Risk] Introducing tokens broadly could tempt scope creep into
  restyling every screen** → Mitigation: proposal.md explicitly scopes this
  slice to three surfaces; tasks.md holds that line.
- **[Trade-off] Dark mode tokens must be authored for both modes up front**,
  costing more initial design time than shipping light-only → accepted,
  since retrofitting dark mode after the fact against ad hoc opacity values
  was exactly today's problem.

## Migration Plan

No data migration. Rollout is a normal code change: land tokens + base
components first (additive, nothing consumes them yet), then convert the
three surfaces one at a time, verifying each visually and against its
existing E2E coverage before moving to the next. Rollback is a normal
revert — no persisted state depends on this slice.
