---
name: terraform-docs
description: Regenerate the module README's inputs and outputs tables with terraform-docs after changing variables.tf or outputs.tf, instead of editing the tables by hand. Use whenever a variable, an output or a module description changes, and before a pull request that touches .tf files.
allowed-tools: Read, Grep, Glob, Bash
---

# terraform-docs

The README tables (Inputs, Outputs, Providers, Modules, Requirements) are generated from the `.tf` files by terraform-docs. A hand edit is overwritten by the next run and produces a diff nobody asked for.

## Steps

1. Change `variables.tf` / `outputs.tf` — descriptions included; the description is what the table shows.
2. Find the configuration: `.terraform-docs.yml` at the module root, or the `terraform_docs` hook in `.pre-commit-config.yaml` (its args say where the markers in the README are).
3. Run it from the module folder: `terraform-docs markdown table --output-file README.md --output-mode inject .`, or `pre-commit run terraform_docs --all-files` when pre-commit is the configured way. Not installed here — say so; do not hand-edit the tables instead.
4. `terraform fmt -recursive` and `terraform validate`, then check that `git diff README.md` shows only the rows you changed.
