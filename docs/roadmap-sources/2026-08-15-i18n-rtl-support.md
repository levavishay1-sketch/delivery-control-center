> **Provenance note (added by the agent when saving this file — not part of
> the original message):** Saved verbatim (as given in chat) per CLAUDE.md's
> "Durable inputs" policy. The user gave this requirement directly in
> conversation, immediately after Slice 7 (design system foundation &
> premium UI refresh) was completed and archived. It is treated as new,
> not-yet-scoped roadmap input — a real product requirement that must not
> live only in conversation history.

---

The product must be i18n-ready from day one, with Hebrew and English as the
initial supported languages.

Hebrew must be treated as a true RTL experience, not just translated text.
Account for RTL/LTR layout, navigation rail, drawers, tabs, tables, forms,
icons, spacing, alignment, dates/numbers, and all other UI patterns.

Keep the implementation lightweight and avoid unnecessary localization
complexity. The architecture should make adding more languages later
straightforward.

Incorporate this into the Slice 7 design-system implementation without
changing the existing domain/backend architecture.
