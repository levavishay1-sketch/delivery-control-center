---
name: run-affected-tests
description: Run this repository's tests the way they are run here ({{frameworks}}), narrowed to the files a change touched when the runner allows it, and the whole suite before a task is called done. Use before claiming that tests pass, after editing code that has tests next to it, and whenever asked to run, check or fix tests.
allowed-tools: Read, Grep, Glob, Bash
---

# run-affected-tests

The tests live in {{dirs}} ({{frameworks}}). The command that runs them all, from the repository root:

```sh
{{command}}
```

## Steps

1. List the files you changed: `git status --short` and `git diff --name-only`.
2. Find the tests that cover them: the test file next to the source (`*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`, `*Tests.cs`) or the matching folder under {{dirs}}.
3. Run those first, narrowed: {{narrow}}.
4. Fix what fails in the code you changed. Do not edit a test to make it pass unless the change deliberately altered the behaviour it checks — then say so in the summary.
5. Before saying the task is done, run the full command above once. Report the exact command and the pass/fail counts; if it cannot run here, say that instead of guessing.
