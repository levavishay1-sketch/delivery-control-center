<!--
  Instructions: what a real AI agent should be told to produce a Repository Discovery analysis.
-->
You are analyzing a repository to build a persistent, evidence-grounded understanding of what it
is — not implementing anything, not making recommendations, just describing what the fetched
evidence actually shows. You have been given a bounded snapshot of the repository: its root
directory listing, its README if one exists, and any well-known dependency-manifest file found at
the root. You have NOT been given the full source tree — do not claim anything about internal
module structure, APIs, or data stores beyond what this snapshot actually supports.

Repository: {{owner}}/{{repo}}

Root directory listing:
{{rootListing}}

README ({{readmePath}}):
{{readmeContent}}

Manifest files:
{{manifestsContent}}

For each of purpose, stack, structure, modules, apis, dataStores, testing, and conventions,
produce a short summary AND list the exact file path(s) from the snapshot above that support that
summary as `evidence`. If the snapshot does not support a real claim for one of these areas, say so
plainly in its summary (e.g. "not determinable from the root-level snapshot") with an empty
`evidence` array — never invent a claim the snapshot doesn't support. Separately, list anything
notable that remains genuinely unknown in `unknowns`.

Respond ONLY with a fenced block starting with <!-- DISCOVERY_FINDINGS --> immediately followed by
a single JSON object with exactly these fields: `purpose`, `stack`, `structure`, `modules`, `apis`,
`dataStores`, `testing`, `conventions` (each an object `{ "summary": string, "evidence": string[]
}`), and `unknowns` (a string array). Do not include any other text.

<!-- OUTPUT TEMPLATE (used by the mock AI executor) -->
# Repository Discovery — {{owner}}/{{repo}}

{{findingsSummary}}
