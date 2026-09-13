# Component deployment & environment management — tasks

Appetite: **large** (not sized precisely yet — needs a design pass first).

**Status: entirely blocked on 0.1, not started.** Unlike the other
backlog items worked through this session, nothing here is buildable
without a human survey of Altshuler Trade's (or whichever pilot
client's) actual deployment reality — which components exist, how each
is deployed today, what "a version" even means per component type. That
isn't in the codebase to find, and isn't something to guess: every
schema decision downstream (component registry shape, environment
config shape, versioning model — 0.2/0.3, then 1.1/1.2) depends on real
answers from 0.1. Inventing a plausible-looking component-type enum or
deploy-method schema without that survey would very likely be wrong and
need redoing, and would misrepresent unverified guesses as a completed
design pass. Deliberately left as pure backlog this session rather than
building speculative scaffolding.

## 0. Design (do first, before any of the below)

- [ ] 0.1 Survey the pilot client's actual component types and how each
      is deployed today (manually) — plugins, web resources, Plugin
      Registration, WebJobs, anything else
- [ ] 0.2 Decide the versioning model: what "a version" means per
      component type, and how it maps to DCC's existing task/commit
      history
- [ ] 0.3 Decide environment configuration shape (schema) — per client,
      with an open-ended list of environments, not a hardcoded 3

## 1. Registry

- [ ] 1.1 Component registry schema + CRUD (type, deploy method,
      per-environment target config)
- [ ] 1.2 Environment registry schema + CRUD (client-scoped, open-ended
      list)

## 2. Deploy action

- [ ] 2.1 A deploy action per component × environment × version,
      explicit and reviewed (never automatic)
- [ ] 2.2 Deploy history recorded on the timeline (who, what, where,
      when, from which task/commit if applicable)

## 3. UI

- [ ] 3.1 Component/environment configuration screens
- [ ] 3.2 Deploy action UI (pick version, pick environment, confirm)
- [ ] 3.3 Deploy history view
