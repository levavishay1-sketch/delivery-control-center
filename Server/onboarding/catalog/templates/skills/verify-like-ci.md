---
name: verify-like-ci
description: Run the same checks the CI ({{systems}}) runs, in the same order, locally, before a change is declared finished. Use before opening a pull request, before saying "done", and whenever asked whether the CI would pass.
allowed-tools: Read, Grep, Glob, Bash
---

# verify-like-ci

CI here: {{systems}}. Its commands, in order, as the workflow files list them:

```sh
{{commands}}
```

## Steps

1. Run the commands in this order from the repository root, stopping at the first failure.
2. A command that needs something this machine lacks (a service, a secret, a Windows runner, a browser) is not a pass: say which one and what it needs.
3. Fix a failure in the code you changed; never change the checks to make them pass.
4. Report each command with pass / fail / could not run, verbatim. "Done" means every one of them passed here.
