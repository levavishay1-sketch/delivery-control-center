---
name: docs-sync
description: Keep `{{pointer}}` true when the code it describes changes — read it before planning a change in an area it covers, and update it in the same change. Use before touching a subsystem the documentation describes, and whenever a change alters how the repository is built, organised or run.
---

# docs-sync

`{{pointer}}` is where this repository explains itself. It is useful only while it is true.

## Steps

1. Before planning, read the part of `{{pointer}}` that covers the area you are about to change. Take its terms and its boundaries as the starting point.
2. If the code and the document disagree, say which one you believe and why before editing either.
3. Make the code change. Then re-read the same part and change every sentence the code made untrue: commands, paths, names, sequences, numbers.
4. Do not add prose that restates the code; keep the document's level of detail and its tone.
5. In the summary, name the sections you changed, or say "docs: nothing to change" and why.
