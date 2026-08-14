# Roadmap sources

This directory holds **verbatim, unedited copies** of planning, requirements,
or gap-analysis documents the user has provided — the raw material that
`docs/ROADMAP.md` is curated from.

## Rules

- **Verbatim only.** Paste the document exactly as given. Do not summarize,
  trim, or "clean up" on the way in — summarization is what caused this
  directory to be created in the first place (see the entry below).
- **Immutable once added.** Never edit a file here after it's committed. If
  the user provides a revised or expanded version of a document, add it as a
  new dated file and note the supersession in `docs/ROADMAP.md`.
- **Naming**: `YYYY-MM-DD-short-slug.md`, dated the day it was received.
- **Every file needs a one-line header** (added by whoever saves it, not part
  of the verbatim content) stating what it is and when/how it was received,
  e.g. "Pasted into chat by the user on 2026-08-14, in a single message."

## Why this exists

On 2026-08-14, a multi-slice product roadmap (a "gap analysis" comparing the
built system against a fuller product vision, with six planned slices of
future work) was pasted into a chat session and never saved to the repo.
Only the slice this session was actively working on (Slice 0) got a durable
plan file. When that conversation was later summarized for context-window
management, the detail for the other five slices compressed down to
one-line labels — the summary of a summary. By the next session, the
original scope was unrecoverable from anywhere in the repo or git history.

`docs/ROADMAP.md` and this directory exist so that never happens again:
raw inputs are saved here immediately, in full, before any planning or
scoping work begins against them.
