---
name: emulator-free-verify
description: Verify a mobile UI change without an emulator or a device — the unit tests, the screenshot tests ({{screenshot}}) and a careful read of the layout code — and say plainly what could not be verified. Use whenever a change touches screens, composables, views or layouts and no device or emulator is available.
allowed-tools: Read, Grep, Glob, Bash
---

# emulator-free-verify

There is no emulator here. A UI change is verified by what runs on the JVM; everything else is reported as unverified, not assumed.

## Steps

1. Run the unit tests of the changed module (`./gradlew :<module>:testDebugUnitTest`, or the repository's equivalent).
2. Screenshot tests: {{screenshot_steps}}
3. Read the layout as a reviewer would: state handling, previews (`@Preview`), string resources, both orientations, dark theme, RTL.
4. Report three lists: verified (with the command), not verifiable here (with what a person must do on a device), and assumptions.
5. Never write "tested on device" or describe behaviour you did not observe.
