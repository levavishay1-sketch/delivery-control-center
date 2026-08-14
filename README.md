# Delivery Control Center

A transparent, gated, audited software delivery system: work items come in from
Jira (or are entered manually), get pulled through a **Constitution → SPEC →
Plan → Tasks → Deploy** pipeline, and every draft, approval, rejection, and
cost is recorded in an append-only audit trail. AI agents draft each stage;
humans approve at every gate before the pipeline advances.

This is the v1 bootstrap: one integration (Jira) and the full pipeline. AI
drafting uses a real Claude call when `ANTHROPIC_API_KEY` is set, and falls
back to a templated mock executor when it isn't — either way the whole
workflow (drafting, gating, auditing, cost tracking) works end-to-end.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind) — one app, UI + API routes together
- Prisma 7 (`@prisma/adapter-pg` driver adapter) against Postgres
- Everything about the pipeline shape is config-driven: see [`config/workflow.yaml`](config/workflow.yaml)
  and [`config/prompts/`](config/prompts) — no stage order or gate rule is hardcoded in the app.

## Setup

### 1. Get a free Postgres database

This project uses plain Postgres, no Docker required. The easiest free option
is [Neon](https://neon.tech):

1. Sign up and create a project.
2. Copy the connection string it gives you (starts with `postgresql://...` and
   includes `?sslmode=require`).
3. Paste it into `.env` as `DATABASE_URL`.

### 2. Install and migrate

```bash
npm install
npm run db:migrate   # creates the schema in your database
npm run db:seed      # adds a demo project + work item + pipeline
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the seeded
"Delivery Control Center Demo" project with one work item — click into it to
walk it through all 5 stages: **Draft with AI** → review the generated
Markdown → **Approve** (or Reject, which sends it back for a redraft) → repeat
until Deploy is done. Check `/audit` afterward to see every step logged.

### 3. (Optional) Connect Jira for real

Leave `JIRA_*` unset in `.env` and use the "Manual" integration — you can add
work items by hand and they'll flow through the same pipeline. To pull from a
real Jira Cloud project instead:

1. Create an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Fill in `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` in `.env`.
3. Add a project through the UI with integration type "Jira", then click **Sync**.

### 4. (Optional) Turn on real AI drafting

Leave `ANTHROPIC_API_KEY` unset and stages are drafted by a mock executor
(fills the prompt template with work-item context, no API call, fake but
plausible cost numbers). To have Claude actually draft them:

1. Set `ANTHROPIC_API_KEY` in `.env`.
2. Optionally set `AI_MODEL` (defaults to `claude-sonnet-5`).
3. Draft a stage — the stage's recorded `aiModel` shows which executor ran (`mock-agent-v1` vs. the real model), so it's always visible after the fact.

## How it fits together

```
config/workflow.yaml   → defines the stage sequence + which stages need approval
config/prompts/*.md    → what the AI is asked to produce for each stage
src/lib/config.ts      → loads the above at runtime (edit the YAML, the pipeline changes — no code touched)
src/lib/agents/        → AgentExecutor interface + mockExecutor + claudeExecutor, selected by getAgentExecutor()
src/lib/integrations/  → IntegrationAdapter interface + manual/jira adapters (add Azure DevOps the same way)
src/lib/pipeline.ts    → stage transitions: draft → submit for approval → approve/reject → advance
src/lib/audit.ts       → recordAuditEvent() — the single write path for the audit trail
```

Every stage transition — an AI draft, a human approval or rejection, a
pipeline advancing to its next stage, a sync from Jira — writes to
`AuditEvent` in the same database transaction as the state change it
describes, so the audit trail can never drift from what actually happened.

## What's still mocked or missing

- **Approver identity** is just a free-text name typed into the approval gate
  — there's no auth system yet, so the audit trail records who *said* they
  approved, not a verified identity.
- **Azure DevOps** isn't implemented; projects configured for it fall back to
  the manual adapter.
- **Cost is approximate** — computed from real token usage but fixed list
  pricing, not accounting for prompt-caching discounts.

## Useful commands

```bash
npm run db:studio   # browse the database in Prisma Studio
npm run build        # production build + typecheck
```
