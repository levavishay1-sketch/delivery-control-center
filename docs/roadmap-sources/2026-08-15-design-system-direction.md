> **Provenance note (added by the agent when saving this file — not part of
> the original document):** This is the design direction produced by the
> agent, in conversation, in response to the user's explicit request to
> "recommend the strongest overall UX and visual design direction" for
> selling this product as "a modern, premium, professional software
> product." The user then said "start do it base on your advice" —
> authorizing implementation of this direction. Saved verbatim (as given in
> chat) per CLAUDE.md's "Durable inputs" policy, since it is multi-step
> design input driving a real slice of work and must not live only in
> conversation history.

---

# Design direction: premium SaaS UX/UI for Delivery Control Center

Confirmed by inspecting the current code: the current UI is unstyled Tailwind
defaults — system font, `border-black/10`, bare `rounded-lg` cards, underlined
text links, no elevation, no custom palette beyond stock `emerald-500`. It's
honest and accessible, but it reads as a well-organized internal tool, not a
product anyone would pay enterprise prices for. Here's the design direction.

## 1. Overall product design direction

**What it should feel like:** a mission-control instrument, not a filing
cabinet. The product's actual job — per the master prompt's own framing — is
answering "what's happening, why, does anyone need to act, what's next"
continuously, across dozens of concurrent work items, for people (PMs, tech
leads, security reviewers) who are triaging, not browsing. The design should
feel like **an operations cockpit**: calm at rest, sharp the instant something
needs a human, and fast to scan under pressure.

**Philosophy: structured clarity over decoration.** Everything in this
product is a decision, a status, or a piece of evidence for a decision —
never marketing content, never a dashboard-for-dashboard's-sake vanity
metric. The design philosophy should be closer to **Linear's
engineering-grade restraint** or **Vercel's dashboard sobriety** than to
typical "enterprise SaaS" (which tends toward dense gray tables and
gratuitous chart widgets). Every visual element should answer "does this
help someone act faster or more correctly" — if not, cut it.

**What makes it feel premium:**
- **Restraint, not richness.** Premium in 2026 SaaS reads as *edited*, not
  decorated — one accent color used sparingly and meaningfully, generous
  negative space, a tight type scale, no gradients, no decorative icons.
- **Confidence in typography and spacing**, not in visual flourish. A
  premium product trusts hierarchy (size/weight/color) to do the work that
  borders and boxes do in cheap admin tools.
- **State-awareness everywhere.** Nothing renders "0" or empty silently —
  every state (loading, empty, stale, error) is deliberately designed,
  which is a signal of craft users register even subconsciously.
- **Explained intelligence.** The product already has a hard rule that AI
  recommendations, risk, and status must always carry a rationale (§6 of
  the master prompt). Visually, this should read as *quiet confidence* —
  small, well-set explanatory text next to every judgment, not a
  chatbot-style "AI insight!" badge. That restraint is itself a premium
  signal; the loud AI-badge treatment (purple glow, sparkle icons) is what
  makes tools feel like a demo, not a product.

## 2. Information hierarchy

The core hierarchy principle: **attention state outranks everything else,
and everything else is subordinate to it until opened.**

Priority order, top to bottom, everywhere in the product:
1. **Does this need me right now?** (blocked / decision-required /
   overdue) — always the loudest visual signal on screen, using color +
   icon + a one-line reason, never color alone.
2. **What is its current state?** (in progress, review, done) — medium
   visual weight, calm colors.
3. **Supporting metadata** (owner, project, dates, cost) — lowest visual
   weight, small type, muted color, revealed on demand or in secondary
   rows.

Concretely: risk/blocked/decision-required states get a **left-edge color
bar + status chip + one-line reason inline**, never a subtle badge buried
in metadata. Everything else (owner avatars, dates, cost figures) should be
visually quiet — small, gray, monospace-for-numbers where useful — so the
eye is never competing between "this is blocked" and "this was last
touched by Sarah on Tuesday."

## 3. Dashboard / Attention Center

**Recommended layout:** the Attention Center is the actual homepage of this
product — the current split (Dashboard = project list + a small attention
summary, `/attention` = the real thing) is backwards. Merge them
conceptually: **land the user directly in a live attention feed**, with
project/portfolio browsing demoted to a secondary, filterable view, not a
separate page competing for "home."

- **Top strip:** attention counts as a small set of pill/chip counters
  (Decisions · Blockers · Risks · Deadlines · Approvals) — not big
  analytics-style KPI cards with large numbers and sparkline decoration.
  This isn't an analytics dashboard; the number itself isn't the story,
  the items behind it are. Clicking a chip filters the feed below, in
  place — no navigation.
- **Main body:** a single prioritized feed, grouped by urgency-plus-type,
  each row: reason (one line, human language) → owner → recommended/
  required action as a real button, not a status label. This is the
  single most important UX move: **every row must resolve in one click**
  (approve, resolve, answer, reassign) or open Quick View — never require
  a full-page navigation just to see what's being asked.
- **Density:** dense in rows, generous in row height — think Linear's
  issue list, not a spreadsheet. Compact enough that 15–20 items are
  scannable without scrolling on a laptop screen, but each row has enough
  vertical breathing room that the reason text doesn't feel cramped.
- **What makes it different from a generic analytics dashboard:** no
  charts as decoration, no "trends over time" widgets, nothing that
  summarizes without enabling action. Every pixel on this screen should be
  either a fact needing a decision or the control to make that decision. A
  generic dashboard shows you numbers; this one hands you a queue to clear.

## 4. Quick View

**Behavior:** a right-side slide-in drawer (already the right pattern —
keep it), but it should feel **momentary and disposable**, not like a
second page. Fast open/close animation (150–200ms), no full data refetch
flash, background dimmed but visible (so users keep spatial context of the
list they came from).

**What belongs here:** exactly what's needed to make *one* decision without
losing place in the queue — the blocker or decision panel front-and-center
(already correct), core identity (title, type, status, owner), and the
single most relevant piece of context for the decision at hand (e.g., the
dependency that's blocking, not the whole dependency graph). Actions must
be one click, inline, no modal-within-drawer.

**What must stay hidden until 360°:** full timeline history, code/tests/
evidence, configuration, the complete dependency graph, anything requiring
reading rather than deciding. If a user needs to *investigate*, that's a
360° trip, not a Quick View feature — Quick View should never grow tabs.
The moment Quick View needs its own tab bar, it has failed at being
"quick."

## 5. 360° Delivery Record

**Structure:** keep the tab model, but treat **Overview as a
decision-support summary, not a raw field dump.** The other tabs
(Dependencies, Timeline, Code & Changes, Tests, Evidence, Configuration)
are correctly scoped as "go deep on one dimension" — that's good
architecture already; the risk is Overview becoming a giant form.

**Recommended tab order**, matching how someone actually investigates an
item top-down: **Overview → Dependencies → Evidence → Code & Changes →
Tests → Timeline → Configuration.** Evidence and Code & Changes belong
nearer the top than Timeline, because "is this actually verified/shippable"
is a more common question than "what's the full history" — Timeline is an
audit tool, used less often than the completion-status tabs.

**Preventing data-dump overwhelm:**
- Overview shows only what changes the reader's assessment: status +
  reason, risk + reason, blockers/decisions if active (inline mini-panels,
  reusing Quick View's components — don't rebuild), owner/executor, dates.
  Raw metadata (createdAt, internal IDs, sync provenance) belongs in a
  collapsed "Details" disclosure at the bottom, not the main view.
- Each tab owns its own information density — Evidence and Code & Changes
  can be dense/technical since that's their job; Overview stays sparse
  always. This variable density by tab is intentional and correct, not a
  flaw to smooth over.
- Empty/stub tabs (currently Configuration for work-item scope) should
  read as **deliberately empty with a clear reason** ("not configured at
  this level — inherits from Client"), never a blank tab, which reads as
  broken rather than honest.

## 6. Visual language

- **Typography:** one variable sans (Inter or similar — already common,
  cheap to adopt, reads premium when set well) with a tight, disciplined
  scale: 4–5 sizes max (12/13 → 14 → 16 → 20 → 24px), medium/semibold for
  hierarchy rather than many weights. Numbers (cost, counts, dates) in
  tabular figures so columns align.
- **Spacing:** a 4px/8px base grid, generous section spacing (32–48px
  between major sections), tighter internal card/row spacing (8–12px) —
  the current code already uses Tailwind's scale reasonably; the fix is
  consistency and intentional whitespace at the macro level, not the
  micro level.
- **Color strategy:** one neutral scale (near-black/near-white, not pure
  #000/#fff — current `black/10`/`white/15` opacity-based borders are a
  known "unstyled Tailwind" tell) + the semantic status palette the master
  prompt already specifies (green/blue/purple/amber/red) used **only** for
  status, never decoratively. One single accent/brand color, used
  sparingly for primary actions and active states only — not currently
  defined at all, and its absence is a big part of why the product reads
  generic.
- **Status semantics:** status as a small filled dot or left-bar + text
  label, consistently positioned, never a colored full-card background
  (which gets visually loud at list scale) — reserve full-color treatment
  for the rare "critical/blocked" emphasis case only.
- **Cards vs tables vs panels:** lists of like items (Attention feed, audit
  log, work items) → **rows in a bordered list, not cards** — cards are for
  dashboards of dissimilar things (Quick Access project tiles are correctly
  cards today). Tables only for genuinely tabular, sortable/comparable data
  (cost breakdowns, run history). Panels (bordered sections with a heading)
  for grouped detail within Overview/360°.
- **Borders, shadows, surfaces:** near-flat design with **hairline borders,
  not shadows**, for most surfaces (shadows read as "old enterprise
  skeuomorphism" at this point) — reserve a soft shadow exclusively for
  genuinely elevated/floating elements: the Quick View drawer, dropdown
  menus, modals. This restraint is a strong, current premium-SaaS signal
  (Linear, Vercel, Height all do this).
- **Icons:** one consistent icon set (Lucide or Phosphor, not mixed emoji/
  text), used only for status/action affordance, never decoratively next
  to headings.
- **Motion:** minimal and functional only — drawer slide, tab underline
  transition, row-expand, subtle fade on data refresh. No page-transition
  flourish, no animated counters. Motion here should communicate "state
  changed," never "look how polished we are."

## 7. Navigation

**Recommended model: a persistent left icon+label rail** (Attention ·
Dashboard/Projects · Pipelines · Audit · Configuration), collapsed to
icons-only by default with labels on hover/expand — the Linear/Height
pattern — rather than the current bare top-of-page text links.

Why this fits: this product has a small, stable set of top-level
destinations (5–7), used constantly throughout a session, by users who
stay in the app for extended stretches (triage sessions) rather than
visiting once and leaving. A persistent rail keeps navigation reachable at
all times without consuming header space that should go to context
(current client/project, search). A top navbar or hamburger menu would be
wrong here — both are built for infrequent navigation or small screens,
not the "always-open control room" usage pattern this product has.
Command-K search/palette (currently missing — flagged in the gap register)
should be the fast path for anything not in the rail, reinforcing that the
rail stays small and stable.

## 8. Design references

- **Linear** — for density-with-calm and status-as-first-class-citizen.
  Specifically borrow: the left icon rail, the flat hairline-bordered list
  rows, the restrained single-accent-color use, and how status changes get
  subtle, fast micro-animation instead of a modal confirmation. Do not
  borrow: Linear's issue-tracker-specific interaction model (that's a
  different product shape).
- **Vercel Dashboard** — for how a technical, high-density product still
  reads premium: near-monochrome base palette, one bold accent, real
  information density without visual noise, and confident use of
  whitespace at the macro level even while showing a lot of data per
  screen.
- **Height / Height.app** — closest functional analog (attention-first
  work management), useful specifically for how they handle "why is this
  blocked" inline explanations and their Quick-View-equivalent side panel
  pacing.
- **Stripe Dashboard** — for the evidence/audit-trail parts specifically
  (Code & Changes, Tests, Evidence, Timeline tabs): Stripe's event-log and
  object-detail pages are the best reference for showing dense, technical,
  timestamped provenance data without it feeling like a database dump —
  worth studying for the Timeline and Evidence tabs specifically, not the
  whole product.

Do not reference generic "admin dashboard template" products (typical
React admin kits, most legacy PM tools like Jira/Azure Boards) — those are
exactly the aesthetic this product needs to visually distance itself from,
per the master prompt's own "not a Jira clone" framing.

## 9. What should change from the current UI — explicit

- **No defined color system.** Borders are `black/10`/`white/15` opacity
  hacks, not real tokens; the only real color used is stock Tailwind
  `emerald-500`. This is the single biggest "internal tool" tell in the
  codebase. Needs a real palette: neutral scale + one accent + the five
  semantic status colors, defined once as tokens.
- **Text links styled as underlined blue-ish text** (`underline opacity-70
  hover:opacity-100`) — reads like an unstyled HTML page, not a product.
  Needs real button/link components with consistent, intentional
  treatment.
- **No typographic hierarchy beyond `text-xl`/`text-sm`/opacity tricks.**
  Headings, body, and metadata are currently differentiated mostly by
  opacity, not by a real type scale — opacity-based hierarchy reads muddy
  and low-contrast, which is also an accessibility risk (the WCAG AA gap
  already flagged in the roadmap).
- **The Dashboard/Attention split.** Two competing "home" surfaces (`/`
  and `/attention`) is a genuine information-architecture problem, not
  just a visual one — fix per §3 above.
- **Cards used for everything** (`rounded-lg border p-4` on nearly every
  element, including list rows) rather than distinguishing rows-in-a-list
  from cards-as-tiles — flattens the visual hierarchy and makes dense
  screens (audit trail, attention feed) feel heavier than they need to.
- **No elevation system** — nothing currently distinguishes "sits on the
  page" (Overview panel) from "floats over the page" (Quick View drawer)
  beyond a border, which makes the drawer feel like part of the page
  rather than a temporary overlay.
- **No icons at all currently** — status is text-only. Adding a small,
  consistent icon set for status/action would meaningfully increase scan
  speed and perceived quality at near-zero cost.

## 10. Recommended design system direction

Principles for every future screen, so the product stays coherent as it
grows:

1. **Attention state is a first-class design token**, not an inline color
   choice — every component that can carry a status (row, card, badge,
   tab) consumes the same five-value status enum with a fixed,
   non-negotiable visual treatment (icon + color + label position). No
   screen invents its own status styling.
2. **Two elevation levels only**: flat (on-page: hairline border, no
   shadow) and floating (overlay: shadow + backdrop dim). Nothing in
   between — resist the urge to add a third "slightly raised" card style.
3. **One accent color, used only for primary actions and active
   navigation/tab state.** Never used decoratively. If a screen wants to
   draw attention without an action attached, it uses type weight/size,
   not color.
4. **Density is set per context, not globally.** Feeds/lists (Attention,
   Audit) are dense; decision surfaces (Quick View, Overview) are
   spacious. This is a rule to document explicitly so future screens
   don't default to one density everywhere.
5. **Every status, risk, or recommendation ships with its explanatory
   text as part of the same component**, not as an optional tooltip —
   enforced at the component-library level (a `StatusBadge` component
   that structurally requires a `reason` prop) so the master prompt's
   "never show an unexplained score" rule is impossible to violate
   accidentally in new screens.
6. **Empty/loading/error/stale states are part of every component's
   contract**, designed once per pattern (list, panel, tab) and reused —
   not designed ad hoc per screen, which is how products end up with 10
   different "no data" treatments.
7. **Progressive disclosure is structural, not just visual** — a new
   feature's information must be sorted at design time into "belongs in
   the feed row," "belongs in Quick View," or "belongs in 360°," using
   the same test used above (does this help a decision, or does it
   require investigation) — this is a product-design rule as much as a
   visual one, and it's what keeps the three-level model from eroding as
   more data gets added over time.

## Scope note for the first implementation slice

The user approved starting implementation of this direction ("start do it
base on your advice"). First slice scope, agreed as: design tokens + base
components (`StatusBadge`, row/list primitives, panel, drawer elevation) +
restyle of the three core surfaces (Dashboard/Attention Center, Quick View
drawer, 360° Delivery Record). Does not add new domain features, entities,
or change any backend behavior — purely visual/structural UI layer on top
of the existing, unchanged domain model and data.
