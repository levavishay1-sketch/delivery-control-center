# Pull requests — one place that says what is waiting, and why

Status: **in progress** — see `tasks.md`.

Appetite: **large**.

## Goal

A person responsible for delivery should be able to open one screen in DCC and
know, across every client and every git host, what is waiting for a decision,
what is stuck, and what changed while they were away — and then act on it
without translating git into their head first.

Today that answer lives in GitHub and Azure DevOps, one repository at a time,
in English, in the vocabulary of the tool rather than of the work. DCC already
knows the missing half: which client a repository belongs to, which task or
onboarding run produced a branch, who ran it, what it cost, and every decision
taken on the way. Joining the two is the whole feature.

## What the screen answers

- **What is waiting for me, everywhere?** One list, grouped by client and
  repository, from every connected host.
- **Is this change still based on current work?** When the branch was taken,
  how far the base has moved since, and whether the moves touch the same files.
  Drawn, not described.
- **How did it get here?** The run, the commits, the push, the review, and what
  moved on the base while the request was open — in one timeline, with the
  events DCC already records.
- **What happens if I act?** Every action states its consequence in plain
  Hebrew before it runs, and what it would leave behind if it fails.

## Principles this follows

- **The host stays the source of truth.** DCC mirrors and enriches; it never
  keeps a competing copy of a pull request's state.
- **No silent actions.** Every action DCC performs on a host is a person's
  action, recorded as an event with their identity.
- **The wall between clients holds.** Every row carries `client_id` and an RLS
  policy, like every other tenant table.
- **No assumption about how the team branches.** The screen is built from the
  base-branch relation between requests, not from naming conventions. A flat
  repository, a project branch with tasks under it, or a deeper stack all
  render from the same data, so changing how the team works changes nothing in
  the screens.
- **More convenient than the workflow it replaces**, or it will not be used:
  the page must be worth opening before the host's own interface.

## Out of scope

Reviewing code (comments and diffs stay in the host), merge queues, and
engineering metrics dashboards. DCC links out for those.
