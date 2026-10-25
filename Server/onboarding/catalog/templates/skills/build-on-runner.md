---
name: build-on-runner
description: Build the Windows-only solution (`{{solution}}`) on the team's Windows build runner instead of claiming a local build — this repository cannot compile on Linux or macOS (msbuild, .NET Framework, signed assemblies). Use whenever a build or a test run is needed and you are not on a Windows machine with the Visual Studio build tools.
allowed-tools: Read, Grep, Glob, Bash
---

# build-on-runner

`{{solution}}` builds only with msbuild on Windows. There is no way to compile it or run its tests here.

How to reach the runner: {{RUNNER}}

## Steps

1. Read the line above. No runner is described there, or it says "none configured": stop here and say so, plainly — "cannot build here; no Windows runner is configured". Do not say the build passed, do not say it probably passes, and do not go on to the next step of the task as if it had.
2. A runner is described: submit the build as described, wait for it, and read the log.
3. Report the exact result — errors with file and line, or the passing build's identifier and time. Never summarise a log you did not read.
4. A failure on the runner that you cannot reproduce here is a person's to judge: say what you see and ask.
