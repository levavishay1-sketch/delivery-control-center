---
name: change-recipe
description: The changes this repository makes again and again — each one the set of files that change together, in order, learned from its git history. Use before starting a change that looks like one of the recipes below, so no file in the set is forgotten.
---

# change-recipe

The git history shows the same groups of files changing together. A change that touches one of them almost always has to touch the rest; a pull request that forgets one is the usual way a build or a test breaks here.

{{recipes}}

## How to use a recipe

1. Match the request to a recipe by its files. No match — this skill does not apply; say so and go on.
2. Open every file in the recipe before editing the first one, and note what the others expect of it.
3. Make the change across the whole set, in the listed order, then run the tests that cover it.
4. In the summary, list the recipe's files you changed and any you deliberately left out, with the reason.
