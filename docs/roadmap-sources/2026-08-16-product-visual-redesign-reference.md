# Product-wide visual redesign — reference-driven (2026-08-16)

Verbatim user request, received 2026-08-16 in conversation, attaching a
reference screenshot (a purple-branded SaaS dashboard — sidebar navigation,
white workspace, stat cards, project cards, activity table). Persisted here
per CLAUDE.md's "Durable inputs" rule before any OpenSpec proposal is
written against it.

The reference image itself is not re-embedded here (binary attachment, not
persistable as text) — it showed: a deep-purple branded sidebar with logo,
nav items with icon+label and a strong pill-shaped selected state, and
account context at the bottom; a light neutral page background; a
predominantly white main workspace with generous outer margins and rounded
outer geometry; a header row with page title/subtitle, a search input, a
notification bell, and a solid purple primary button; four stat/summary
cards (icon in a soft tinted circular badge, a large number, a label, a
small trend/delta line); a row of project cards (status pill, key/value
metadata pairs, avatar stack, overflow "+N", a kebab menu); and a table of
recent activity/work items with avatar, project, task, priority pill,
status pill, AI-confidence indicator, last-updated, and a row action menu.
Status/priority pills were soft-filled rounded badges in restrained
semantic colors (green/amber/red/blue) against an otherwise white/purple/
neutral palette — purple was not applied to every element.

---

## Full Product UI Redesign Based on the Attached Visual Reference

I want you to redesign the UI of this existing application.
I am attaching a reference image that represents exactly the visual direction, design language, level of polish, proportions, density, and overall product feeling I want.
This is not just general inspiration.
I want the finished product to feel as if the same designer who designed the attached reference designed my entire application.
The reference image is a dashboard, but the requirement applies to the entire product, not only the dashboard.

### First: Understand the Existing Product

Before changing the UI, inspect the existing project thoroughly.
Understand:

- what the product does,
- its current screens,
- navigation,
- workflows,
- entities,
- forms,
- tables,
- project-related functionality,
- work-item functionality,
- approval flows,
- configuration,
- settings,
- authentication,
- actions,
- statuses,
- alerts,
- existing reusable UI,
- existing styling approach,
- RTL behavior,
- and any other user-facing functionality.

Do not redesign the product based on assumptions.
Understand the real application first, and then redesign its presentation.

### Preserve the Product — Redesign the Experience

Do not replace the existing application with a new demo.
Do not create a separate static dashboard.
Do not replace real product functionality with the functionality shown in the reference image.
Do not invent fake business features simply because they appear in the reference.
Preserve the application's:

- functionality,
- business logic,
- workflows,
- routes,
- data,
- terminology,
- permissions,
- integrations,
- user actions,
- and existing behavior.

The redesign should change how the product is presented and experienced, not what the product fundamentally does.
You may reorganize the presentation of existing functionality when doing so produces a cleaner and more appropriate user experience, but do not remove important capabilities.

### The Reference Image Defines the Visual Language

Study the attached image carefully.
Do not interpret it merely as: "Use purple and rounded cards." That would be incorrect.
Extract the complete design language from it.
Pay close attention to: overall application composition, application shell, sidebar proportions, main workspace proportions, outer margins, content width, whitespace, section spacing, internal padding, typography, font hierarchy, visual hierarchy, card geometry, panel geometry, border treatment, corner radii, surface colors, background colors, brand color usage, semantic color usage, button styling, input styling, search styling, iconography, navigation, selected states, status badges, tables, lists, metadata presentation, information density, alignment, grouping, balance, and overall visual rhythm.

The final application should have a very strong visual resemblance to the attached reference, not merely a similar color palette.

### Target Product Feeling

The final application should feel like the product shown in the reference: premium, modern, clean, polished, calm, spacious, professional, enterprise-ready, visually coherent, and deliberately designed. It should feel like a mature modern SaaS product.

It should NOT feel like: a generic admin panel, a developer interface, raw HTML forms, an old ERP system, a Bootstrap template, a spreadsheet, a collection of unrelated components, or the existing UI with a purple theme applied on top.

### Application Shell

One of the strongest visual characteristics of the reference is the application shell. Reproduce this same overall feeling. The product should have: a strong branded sidebar, a large clean workspace, clear separation between navigation and content, a very light outer/background surface, a large white primary workspace, generous breathing room, soft rounded geometry, and deliberate page proportions.

The UI must no longer feel like content stretched directly across the browser window. The application should feel like a designed product surface.

### Sidebar

The sidebar is a major visual anchor. It should closely reproduce the design language shown in the attached reference: strong deep-purple brand surface, substantial width, comfortable vertical spacing, clear icon + label navigation, clean typography, highly visible selected state, rounded navigation items, well-balanced padding, product identity at the top, and user/account context at the bottom where appropriate.

The selected navigation item should have the same strong visual contrast and soft geometry seen in the reference. The sidebar must feel intentional and premium, not like a narrow utility menu.

### Main Workspace

The primary content area should feel like the reference: predominantly white, soft and clean, spacious, visually contained, with large rounded outer geometry, subtle separators, restrained borders, and very little visual noise.

Avoid excessive nested boxes. Avoid heavy shadows. Avoid dark borders. Use whitespace, grouping, typography, subtle surfaces, and hierarchy to organize information.

### Color Language

Match the visual color behavior of the reference. The design is based primarily on: deep branded purple, white surfaces, very light neutral backgrounds, dark navy/near-black text, muted secondary text, very light purple-tinted surfaces, subtle borders, and soft semantic colors.

Purple should be used deliberately for: brand identity, primary actions, selected states, links, important icons, emphasis, and interactive elements.

Do NOT make every component purple. Most of the interface should remain light and calm. Use green, orange, red, blue, etc. only where they communicate meaningful status or state, and use them with the same restrained visual treatment shown in the reference.

### Typography

Typography is a major part of the target design. The current product must not feel tiny or compressed. Create a clear hierarchy between: page titles, section titles, card titles, primary values, normal body text, secondary information, metadata, labels, and hints.

Important information should immediately stand out. Secondary information should remain visually quiet. Use a modern font suitable for Hebrew and the application's language requirements. The interface should be highly readable on desktop.

### Spacing and Density

Closely study the amount of whitespace in the reference. This is important. The target interface has: generous page spacing, comfortable card padding, meaningful gaps between sections, comfortable row heights, space around text, space around controls, and clear separation between groups.

The current interface must not remain visually compressed. At the same time, do not make the product wastefully oversized. The target is the comfortable, polished density shown in the reference.

### Cards and Panels

Use the same card language throughout the product. Cards should generally feel: clean, white, softly rounded, subtly bordered, spacious, lightweight, and clearly grouped.

Avoid large flat rectangular areas that look like raw configuration containers. Avoid excessive card nesting. A card should exist because it represents a meaningful information group, not simply to wrap every element.

### Buttons and Actions

Buttons must use the same design language as the reference. Primary actions should be visually clear and branded. Secondary actions should be quieter. Destructive actions should only use destructive styling where appropriate.

Avoid: tiny buttons, browser-default buttons, raw text links used as primary actions, inconsistent button sizes, inconsistent corner radii, and different button styles invented independently by different screens.

Actions should feel cohesive throughout the product.

### Forms

Redesign the application's forms so they belong to the same product. Inputs, selects, text areas, toggles, validation states, labels, help text, and form actions should all share the same visual language.

Forms should be: readable, spacious, clearly grouped, visually calm, and easy to scan.

Do not preserve dense rows of tiny configuration controls merely because that is how the current UI is structured. Where appropriate, organize related configuration into meaningful sections, cards, panels, dialogs, drawers, or dedicated detail areas. Preserve the underlying functionality.

### Statuses and Badges

Statuses should be presented consistently throughout the application. Use compact, soft, rounded status treatments similar to the reference. Status colors should communicate meaning without dominating the interface. The same status should not look different on different screens.

### Tables and Lists

Tables should use the same visual language shown in the reference. They should feel like polished product components rather than spreadsheets. Use: comfortable row heights, clear headers, subtle separators, clean alignment, meaningful badges, contextual actions, avatars/icons where real product data supports them, and strong information hierarchy.

Avoid heavy grids and excessive borders. Large lists should remain easy to scan.

### Icons

Use a consistent icon language throughout the product. Icons should feel like they belong to the same family. Avoid mixing unrelated icon styles. Use icons to improve recognition and hierarchy, not as decoration. Where appropriate, use the same visual treatment seen in the reference, such as simple icons placed inside softly tinted circular or rounded surfaces.

### Empty, Loading, Error and Disabled States

The design language must also apply when the application is not in its ideal populated state. Design proper: empty states, loading states, skeletons, errors, warnings, disabled states, success states, and permission-restricted states.

For example, do not leave a large container with only "No work items yet." Turn it into an intentional product state that belongs to the same design system.

### RTL and Hebrew

The application uses Hebrew, so RTL behavior must be treated as a first-class design requirement. Do not merely flip the entire interface mechanically. Ensure that navigation, content alignment, action placement, icons, chevrons, search, tables, badges, forms, dropdowns, dialogs, drawers, and directional interaction patterns all feel natural in RTL. The result should look intentionally designed for Hebrew.

### The Dashboard

The dashboard should have especially strong visual fidelity to the attached image. Use the application's real information to create the appropriate dashboard presentation. Where supported by real product data, use the visual patterns represented in the reference such as: summary cards, important metrics, projects or primary entities, recent work, alerts, quick actions, important statuses, and attention-required information.

However: do not invent data simply to recreate the screenshot. Do not create metrics that the product cannot actually calculate. Do not create fake users, projects, budgets, alerts, or activities. Use the visual structure and design language, but populate it with the real product.

### Other Screens

This requirement is extremely important: do not stop after redesigning the dashboard. The attached image demonstrates the visual language for the entire product. Review every existing user-facing screen and redesign it accordingly.

Different screens should use layouts appropriate to their function. A settings screen should not artificially become a dashboard. A detail screen should not artificially become a dashboard. A form should not artificially become a dashboard. A pipeline or approval flow should not artificially become a dashboard.

Instead, for every screen ask: how would the same designer who designed the attached reference design this specific screen? Then implement that screen accordingly.

### Product-Wide Consistency

When moving between any two screens, the user should never feel that they entered a different application. Every screen should share the same fundamental visual behavior: typography, spacing, surfaces, colors, buttons, controls, cards, borders, radii, icons, statuses, interaction states, navigation, and hierarchy.

The structure may vary. The design language must not.

### Future Development Is Part of This Requirement

This design must not be implemented as one-off styling that only works for the screens that exist today. Implement the UI according to established professional frontend and design-system best practices so that the visual language is: consistent, reusable, maintainable, centralized where appropriate, easy to understand, and easy to extend.

Future developers or coding agents should be able to add a new screen or feature and naturally continue the same design language without inventing a new UI from scratch. Before introducing new visual behavior, existing shared patterns should be reused whenever appropriate. If the project already contains a good mechanism for managing shared UI, styling, themes, components, or design conventions, use and improve it rather than creating a competing system. If the current project does not adequately support consistent reusable UI, establish the necessary structure using appropriate modern frontend practices. Do this in a way that fits the existing technology and architecture. Do not over-engineer the project. The goal is a professionally managed UI, not architectural complexity for its own sake.

### Avoid Scattered One-Off Styling

Do not solve this redesign by independently styling every page. Avoid a situation where each page has its own button implementation, every feature chooses its own purple, cards have different radii, forms have different input heights, statuses are implemented differently, spacing values are randomly repeated, or visual rules are scattered across unrelated feature files. The product should behave as one visual system.

### Responsive Behavior

The attached image represents the primary desktop target. Desktop fidelity is very important. The application should also adapt correctly to smaller screens. Responsive behavior should preserve the same visual language while adapting layout appropriately. Do not damage the desktop design just to make mobile implementation easier.

### Do Not Blindly Copy Content From the Reference

The screenshot may contain visual examples that do not belong to this product. Do not copy them just to make the screen look more similar. Examples include: fake users, fake projects, fake financial values, fake alerts, fake business entities, fake statistics, or functionality that does not exist. The application should look like the attached product while still being this application.

### Do Not Perform a Minor Facelift

I am explicitly not asking for: color changes, a purple theme, slightly rounder buttons, minor spacing adjustments, or a small improvement to the current layout. I want a real visual redesign. If the existing layout prevents the product from reaching the quality and visual language of the reference, change the presentation structure. Keep the business functionality. Change the UI where necessary.

### Do Not Over-Interpret the Reference

Do not create your own unrelated design direction. Do not simplify the reference into a generic SaaS template. Do not make significant stylistic choices that contradict what can clearly be seen in the attached image. When the image clearly shows a visual principle, follow it. When the image does not show how a particular product-specific screen should work, extend its design language intelligently and consistently. Again, the guiding question is: how would the designer of the attached reference design this part of the product?

### Implementation Expectations

Do not only provide recommendations or a redesign plan. Actually implement the redesign in the existing application. Work through the existing project carefully. Reuse good existing foundations. Refactor UI where necessary. Preserve functionality. Avoid unnecessary rewrites of unrelated application logic. The result must be the actual working product, not a mockup.

### Visual Validation Is Mandatory

Do not judge the result only by reading the code. Run the application and inspect the rendered UI. Compare it directly against the attached reference. Perform visual iteration. After the first implementation pass, specifically inspect: overall silhouette, sidebar, workspace size, white-space distribution, page proportions, typography scale, card dimensions, visual density, section spacing, navigation states, button sizes, borders, radii, tables, forms, color balance, and RTL alignment.

If the result still feels like the old application with new styling, it is not finished. If the result merely looks "similar" because it uses purple, it is not finished. Continue refining it.

### Final Visual Test

When the redesign is complete, I should be able to place (1) the attached reference image, and (2) the redesigned application next to each other and immediately recognize that they belong to the same visual family. The business content will naturally be different. The product functionality will naturally be different. But the design language should be unmistakably the same.

### Final Product-Wide Test

Open multiple screens from the application side by side. Ask: does every screen look like it was designed by the same team? Does every screen clearly belong to the visual world of the attached reference? Are visual decisions consistent across the entire product? Can a future feature be added without inventing another visual language? If the answer to any of these is no, continue refining the implementation.

### Final Instruction

Treat the attached image as the visual standard I want to achieve. I want the application to look as close as possible to this level and style of design, adapted intelligently to the application's real functionality. Do not redesign only the dashboard. Do not merely imitate the colors. Do not copy irrelevant business content. Do not produce a generic interpretation. Extract the complete visual language from the reference and apply it consistently across the entire product. Preserve the real product. Redesign the entire experience. Make it feel like the same designer designed both the attached reference and this application. And make sure that this design language remains natural and easy to continue for every future screen and feature.
