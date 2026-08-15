> **Provenance note (added by the agent when saving this file — not part of
> the original message):** The user pasted a screenshot of a "My File"
> consumer cloud-storage dashboard template (colorful multi-hue category
> cards, a storage-usage donut chart, decorative uploads/downloads/shared
> and file-type trend charts, avatar stacks, a rounded-pill purple primary
> button and CTA, a "Go Premium" upsell card) and asked to "learn this
> design and implement the site will be on this design principle." Given
> this directly conflicted with explicit, spec-locked decisions from Slice
> 7 (one accent color reserved for actions/active state, never decorative;
> no chart without a real informational purpose), the agent asked two
> clarifying questions before any code changed: how much of the reference
> should carry over, and whether its file-storage domain motifs (folders,
> uploads) signaled an actual new feature or should be adapted to the
> product's real entities. The user chose "Full visual overhaul
> (discussion first)" and "Adapt motifs only — translate the visual
> language to our real entities, no new file-storage feature." The agent
> then produced the analysis below — what to adopt, what to reject, and
> why — and the user confirmed the synthesized direction as-is (not the
> literal colorful-card look, keeping the status-color rule intact).
> Saved verbatim per CLAUDE.md's "Durable inputs" policy, since it is
> multi-step design input driving a real slice of work and must not live
> only in conversation history.

---

# Design direction: adapting the "My File" dashboard reference

## The core conflict

The reference is a consumer cloud-storage template. Its visual grammar —
solid saturated color blocks per folder, three decorative trend charts, an
avatar-stack "social" feel, a "Go Premium" upsell — is built for browsing
and engagement. Slice 7 was deliberately built for the opposite job:
triage under pressure ("what's happening, why, does anyone need to act,
what's next"), with a locked-in rule that color = status, never
decoration, and no chart without a reason (see
`openspec/specs/design-system/spec.md`). Adopting the reference literally
would reverse decisions the product's own spec currently enforces.

## What's worth adopting (each earns its place by answering a real question)

1. **A donut chart — for AI budget usage, not storage.** The product
   already has `AI Cost` and `aiBudgetUsd` per Client/Project/Organization
   (Slices 3 and 6). "% of budget used" is the same shape as the
   reference's "% storage used," except actionable here — it belongs on
   the Dashboard and/or Configuration Center.
2. **Solid-pill active state in the nav rail.** Swap the current
   bare-accent-text active tab in `NavRail` for a filled accent-colored
   pill — same single accent color already in use, just a stronger active
   state.
3. **The header search bar → the real global search / Ctrl+K palette.**
   Already a named, flagged gap in `docs/ROADMAP.md`'s gap register (#16,
   "Ctrl+K command palette / global search — still not built"). The
   reference's search-bar placement is the cue to finally close this gap
   — not decoration, a missing feature.
4. **Avatar stacks for "who's involved."** Real member data already
   exists (client memberships, work-item owners). A small avatar stack on
   a project card or Attention Center row showing who's involved is dense,
   real information.
5. **A persistent primary CTA in the header**, mirroring the reference's
   pinned "Upload File" button — e.g. "+ New Work Item" always reachable,
   instead of buried in a page-body form.
6. **Generally roomier spacing / slightly larger corner radius** on
   primary surfaces — cheap, on-brand, doesn't touch the color rule.

Note: the current accent (`#4f46e5`, indigo-600) is already close to the
reference's purple — no accent-color change is actually needed.

## What's rejected, and why

- **Solid multi-hue "category" cards** (blue/orange/pink/green folders) —
  directly violates the design-system spec's "one accent color... never
  purely decorative" requirement. There is no semantic meaning to map 4
  arbitrary hues onto in this domain. The status-color-coded version
  (using the existing 5-color status palette: healthy/active/ai/warning/
  critical) is the honest alternative if colorful cards are wanted later.
- **The Uploads/Downloads/Shared bar chart and the Documents/Photos/
  Videos/Audios line chart** — vanity engagement charts with no "does
  this help someone act faster or more correctly" answer in this domain.
  Not replicated; no fake metric invented to fill the slot.
- **"Go Premium" upsell card** — no product analog; this is not a
  freemium SaaS. Not replicated.

## Confirmed decision

The user confirmed the synthesized direction above (six adoptions,
mapped to real entities; status-color and one-accent-color rules stay
intact) rather than the literal colorful-card look.

## Superseding instruction — broader design mandate

Immediately after confirming the above, the user gave this instruction
verbatim, which widens the brief from "adopt these six fixed items under
Slice 7's existing rules" to a genuine design-judgment mandate — the
agent's own synthesis below (not yet written at the time this note was
added) supersedes the fixed six-item list where they diverge:

> I don't want to copy this reference literally. I want you to learn its
> visual language and apply the same level of polish, hierarchy, color,
> spacing, cards, navigation and overall SaaS feel to Delivery Control
> Center. Use your understanding of our product to decide which elements
> translate well and which don't. The goal is a beautiful, modern,
> premium product — not a generic internal tool. Do not blindly follow
> either the reference or the previous design spec; use your design
> judgment to create the best fit for our product.

This explicitly releases the agent from treating Slice 7's design-system
spec as unquestionable — it may be revised, not just extended, if the
agent's design judgment calls for it.

## Second superseding instruction — visual energy, not just restraint

In response to the agent's first synthesis (Linear/Stripe/Vercel-style
restrained premium direction), the user gave this instruction verbatim,
correcting the direction toward more visual energy while still rejecting
literal copying:

> Go ahead, but one important clarification: I don't want the result to
> be merely "premium/minimal SaaS." I want it to carry the same visual
> energy and liveliness as the reference — rich cards, visible color,
> layered/tinted surfaces, gradients where appropriate, strong visual
> hierarchy, depth, motion and personality. Learn the reference's visual
> language and emotional impact, not just its restraint. The product
> should feel alive at first glance while remaining professional and
> operationally focused. Do not copy the reference literally. Use design
> judgment to translate that visual energy into Delivery Control Center.

The agent's final synthesis, reconciling this with the earlier
"meaningful color only, no arbitrary decoration" position, is recorded
below.

## Final synthesis

**The reconciliation**: richness comes from using the product's *real*
categorical dimensions as color more generously and vividly — not from
adding meaningless decoration. Two dimensions already exist and were
under-used: (1) status/health (5-value palette, already built, used only
in small badges so far) and (2) work-item type (`project`/`task`/`bug`/
`change` — a small, fixed, real enum, structurally identical to the
reference's Documents/Photos/Videos/Audios categories). A third,
optional dimension — a stable per-project/per-client identity color
(hash-derived from a curated palette, for fast visual scanning across
many projects) — is the same pattern calendar apps and Notion use for
workspace/page identity, and is likewise tied to a real, stable identity
rather than arbitrary.

**Concretely, beyond the first synthesis's token/spacing/hierarchy
revisions:**
- Status and type colors get to be *bigger and bolder* — gradient-filled
  icon badges (not flat low-opacity tints), colored card accents/left
  borders, colored section washes — not just small pill badges.
- A per-project/client identity color for quick visual scanning on the
  Dashboard's project cards, structurally parallel to the reference's
  folder colors but tied to real project identity, not arbitrary
  assignment.
- Gradients on primary buttons, stat-tile icon badges, and AI-related
  surfaces (leaning into the existing violet "ai" status color).
- Layered, two-tier shadows and soft color glows behind badges/cards for
  real depth, not flat single-shadow elevation.
- Motion: staggered entrance animation for dashboard cards/stat tiles,
  hover lift/scale on interactive cards, animated count-up on stat-tile
  numbers, skeleton shimmer loading states — building on the drawer's
  existing entrance animation rather than introducing a new pattern.
- A subtle gradient-mesh background wash behind hero/summary sections
  (Dashboard header, Attention Center header) for atmosphere, kept out
  of dense data areas (tables, rows) where it would hurt scannability.

**Still held from the earlier synthesis**: no arbitrary/meaningless
color, no vanity engagement charts, no upsell card, status always ships
with a stated reason, RTL/i18n from Slice 8 unaffected. The difference
from the first synthesis is *how generously* the product's real semantic
color dimensions get to show up, not *whether* color needs a reason.
