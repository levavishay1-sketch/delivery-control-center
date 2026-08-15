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
