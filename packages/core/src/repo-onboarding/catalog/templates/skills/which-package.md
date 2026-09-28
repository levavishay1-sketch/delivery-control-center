---
name: which-package
description: Find which package of this multi-package repository ({{workspaces}}) owns a request before searching the whole tree. Use when asked where something lives, where to add a feature or a test, or which package a change belongs to.
allowed-tools: Read, Grep, Glob, Bash
---

# which-package

Workspaces: {{workspaces}}. {{packages_intro}}

{{packages}}

## Steps

1. {{pick_step}} For a user-facing feature prefer the package that exposes it (an app, a CLI, an API) over the library it uses.
2. Confirm with the package's own manifest and README ({{manifests}}) — not with a whole-tree grep.
3. Only then search inside that package for the code to change.
4. {{build_step}}
5. Say which package you chose and why, in one line, before changing anything.
