# Pull request center — design

## 1. One model, many hosts

Everything on the screen reads from DCC's own `pull_request` row. A provider
fills that row; nothing above the provider layer knows which host it came from.

```
provider (github | ado)  ──sync──▶  pull_request  ──▶  screens
        ▲                                │
        └──────── actions ───────────────┘
```

`PullRequestProvider` is the whole seam:

```ts
listPullRequests(repo, since)       // cheap incremental list
getPullRequest(repo, number)        // one request, full detail
compareBranches(repo, base, head)   // ahead / behind / files
listChecks(repo, headSha)           // build and test state
updateBranchFromBase(repo, number)  // bring the base into the branch
merge(repo, number, strategy)       // the person's own merge
createPullRequest(repo, head, base, title, body)
requestReview(repo, number, reviewers)
closePullRequest(repo, number)
```

- **GitHub** is implemented first through the `gh` CLI already used by
  delivery, so it inherits the operator's existing login; the same adapter can
  later speak REST with a token without touching a caller.
- **Azure DevOps** uses the REST API and the connection DCC already stores for
  work-item sync. Its pull requests carry linked work items natively, which
  feeds the link to a WorkItem for free.

Differences the model absorbs rather than leaks: GitHub returns one review
decision, ADO returns per-reviewer votes (reduced to the same three states);
both report a merge/conflict status under different names; ADO's "id" is per
project, so the key is `(repo_id, provider, number)`.

## 2. No opinion about branching

The hierarchy on the screen is derived, never configured:

- A request's **parent** is an open request whose head branch equals this
  request's base branch. Applied repeatedly, that yields a stack of any depth.
  A repository where everything targets the default branch simply has no
  parents, and the list is flat.
- The **base of the repository** is whatever the host reports as its default
  branch. `main`, `master`, `develop` and anything else are the same to DCC.
- A request whose parent has not merged is flagged, because merging it early
  is what silently retargets the rest of the stack.

DCC's own labels ("this came from an onboarding run", "this is task 142") come
from its links, not from branch names, so a team that renames everything
tomorrow loses nothing.

## 3. Freshness, the question the screen exists for

For every open request DCC stores, from `compareBranches(base, head)`:

- `behind_by` — commits on the base that the branch does not have.
- `ahead_by` — commits on the branch.
- `base_moved_files` — files changed on the base since the branch point that
  the branch also changes. This is the number that turns "12 commits behind"
  into "two of them touch your files", which is what decides whether an update
  is urgent.
- `branch_point_at` — when the branch left the base, and `local_pulled_at` —
  when DCC last refreshed its local clone, so the screen can say whether the
  work started from current code.

## 4. Storage

| Table | What it holds |
| --- | --- |
| `pull_request` | the mirror: identity, state, branches, counts, freshness, review and check state, links to run/task/workitem, `last_synced_at` |
| `pull_request_event` | append-only: opened, pushed, review, base moved, merged, closed, and every action DCC performed. Only `appendPullRequestEvent()` writes it |
| `pull_request_seen` | per user and request, the last time they looked — the source of "since you were away" |
| `repo_git_state` | per repository: default branch and its head, last host fetch, last local pull |

Every table carries `client_id` and an RLS policy. The event table is the
timeline the screen draws and the audit trail for anything DCC did.

## 5. Sync

A timer (default three minutes, configurable) walks the repositories linked to
a client, asks each provider for what changed since the last sync, and writes
the diff as rows plus events. On-demand refresh uses the same path, and the
screen always shows when the data was last refreshed. A repository whose host
cannot be reached keeps its last state and is marked stale rather than emptied.

## 6. Actions

Every action is a person's action: it needs an acting user, records an event
with their identity, and states its consequence before it runs.

| Action | Guard |
| --- | --- |
| Update branch from base | the request is open and the person confirmed; a conflict stops the update, leaves the branch untouched, and offers the next step |
| Request review | the host supports it and reviewers were chosen |
| Merge | not a draft, no conflict, required approvals and checks satisfied, and the parent request (if any) merged first |
| Open a pull request | a branch with commits and no open request for it |
| Close | explicit confirmation |

The merge button exists because DCC is meant to be the place the work is
managed from — but it stays a deliberate press by a named person, never an
automation, and it uses their own credentials on the host.

## 7. Identity

`connectionFor(userId, repo)` resolves the credentials for a call. Version one
returns the operator's local `gh` login for GitHub and DCC's stored connection
for Azure DevOps — enough for one manager. Because every provider call already
takes that connection, moving to a token per user, or to OAuth, replaces one
function and nothing else.

## 8. Screens

1. **בקשות מיזוג** — the list: filters, grouping by client and repository,
   nested children under their parent, and a "since you were away" strip.
2. **A request** — the branch drawing, the freshness sentence, the facts, the
   checks, what the request contains, and the action bar.
3. **Live timeline** — the stages and the events, including what moved on the
   base while the request was open.
4. **An action** — what will happen in three steps, what could go wrong, and
   the result, including the conflict state and its way out.
5. **Branch map** — the repository as a picture: the base, every open branch,
   which requests sit where, and when the local copy was last refreshed.
