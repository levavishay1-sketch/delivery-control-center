---
name: which-package
description: Find which package of this multi-package repository ({{workspaces}}) owns a request before searching the whole tree, and run that package's commands from its own folder. Use when asked where something lives, where to add a feature or a test, or which package a change belongs to.
allowed-tools: Read, Grep, Glob, Bash
---

# which-package

Workspaces: {{workspaces}}. The packages:

{{packages}}

## Steps

1. Pick from the list the one or two packages whose names or paths match the request. For a user-facing feature prefer the package that exposes it (an app, a CLI, an API) over the library it uses.
2. Confirm with the package's own manifest and README (`package.json`, `pyproject.toml`, `go.mod`, `*.csproj`, `Cargo.toml`) — not with a whole-tree grep.
3. Only then search inside that package for the code to change.
4. Run build and test commands from the package's folder; a root command that runs everything is the last resort, not the first.
5. Say which package you chose and why, in one line, before changing anything.
