# What DCC must know about each client's landscape — research findings

Date: 2026-09-27. Web research only; no code changes.

Evidence grades: **[A]** official vendor docs or controlled study · **[B]** observational / benchmark · **[C]** practitioner report.
Where a vendor domain was blocked by the network proxy, the same document was read from its public GitHub source
(MicrosoftDocs/*, backstage/backstage, OctopusDeploy/docs, argoproj/argo-cd, github/docs, harness/developer-hub,
hashicorp/web-unified-docs) — still [A]. Where neither was reachable, the grade carries the note *(via search summary)*
and should be re-verified before quoting. Blocked domains encountered: backstage.io, docs.port.io / port.io / ocean.port.io,
opslevel.com, cortex.io, docs.github.com, github.blog, learn.microsoft.com, devblogs.microsoft.com,
techcommunity.microsoft.com, aws.amazon.com, octopus.com, developer.harness.io, argo-cd.readthedocs.io,
developer.hashicorp.com, modelcontextprotocol.io, arxiv.org (all mirrors), roadie.io, dev.to, huggingface.co.

---

## 0. The owner's questions, answered in one screen

| Question | Short answer | Where the evidence is |
|---|---|---|
| What must DCC know per client? | An **environment × target × credential-reference × process** graph per client, plus the client's *tool per environment* (which CLI/task deploys where), the *promotion order and gates*, and the *per-environment settings* (Dataverse connection IDs, variable groups, tenant variables). See §8 for the entity list. | §2 (all CD tools converge on the same six objects), §3 (Dataverse specifics) |
| When is it collected? | **Three moments.** (1) *Client-level, before any repo*: tenant/subscription/org identifiers, environment list and order, identity/consent (Lighthouse, WIF, application users), vault location. (2) *During repo onboarding*: what the AI can read from CI YAML, `azure.yaml`, `.cdsproj`, `spkl.json`, Dockerfiles — proposed as a draft the human confirms. (3) *Continuously after*: probes and deploy-time discovery keep it current. | §4, §7, §9 |
| Can an AI discover it by itself? | **Partly.** Every IDP's "auto-discovery" today is (a) finding *declared* descriptor files and (b) pulling *inventories* from SCM/cloud APIs; inferring relations/environments from code is new (Port AI, Azure Deployment Agent) and still greenfield or human-confirmed. Credentials, approvals, the client↔environment mapping, per-environment IDs and on-prem topology cannot be discovered. | §4, §9 |
| How to model "a different tool per environment"? | Like Harness/Octopus: the **environment** is a logical stage; each has one or more **targets/infrastructure definitions**; each target carries a **deployment type** and a **connector/account**, and the **process** step is chosen by target type. In Dataverse terms: dev target = `pac plugin push` + PRT; test/prod target = managed-solution import via Build Tools/pipelines. | §2.4, §2.5, §3.6 |
| How to keep it current? | Drift model borrowed from Terraform/Octopus/Backstage: *declared* vs *observed* with timestamps; scheduled health checks; discovery at deploy time; auto-disable after inactivity; nudges on the screen. | §7 |
| How to store secrets? | DCC stores **references, never values**. Federation (WIF/OIDC, Lighthouse) for everything that supports it; a **per-client vault** (Key Vault per client or Vault namespace per client) for what does not; runners read at run time under a managed identity; agent sessions use the human's OAuth identity. | §6 |
| Where is the client-config / repo-onboarding boundary? | Client-level: identities, environments, targets, vaults, promotion policy, related systems. Repo-level: build recipe, artifact type, which solution/project the repo produces, which client target-types it deploys to. The link is a **Component → Deployable → Target** relation, exactly how Backstage links `catalog-info.yaml` to clusters via annotations rather than by putting the cluster in the repo. | §1.1, §8, §9 |

---

## 1. Internal Developer Platform catalogs

### 1.1 Backstage [A]

**Entity model.** Kinds are Component, API, Resource, System, Domain, User, Group, Location, Template — and
**there is no "Environment" kind**. System model doc (GitHub mirror of backstage.io):
https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/system-model.md
- Component = "a piece of software"; API = boundaries between components; Resource = "infrastructure needed for runtime
  operation, such as BigTable databases, Pub/Sub topics, S3 buckets or CDNs"; System = components+resources exposing
  public APIs; Domain = systems sharing terminology/business purpose.

**Descriptor fields** (`catalog-info.yaml`) —
https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/descriptor-format.md
- Component `spec`: `type` (service/website/library — your own taxonomy), `lifecycle` (experimental/production/deprecated),
  `owner` (Group by default), `system`, `subcomponentOf`, `providesApis`, `consumesApis`, `dependsOn`.
- Resource `spec`: `type` (e.g. `database`, `s3-bucket`, `kubernetes-cluster`), `owner`, `system`, `dependsOn`.
- Common metadata: `annotations` (external references, e.g. `backstage.io/managed-by-location`, techdocs ref),
  `labels`, `tags`, `links`.

**How "environments" are really modeled** — via the Kubernetes plugin, not the catalog kind system:
https://github.com/backstage/backstage/blob/master/docs/features/kubernetes/configuration.md
- Entity ↔ runtime link is an annotation: `backstage.io/kubernetes-id`, or `backstage.io/kubernetes-label-selector`,
  `backstage.io/kubernetes-namespace`, `backstage.io/kubernetes-cluster`.
- Clusters come from `clusterLocatorMethods`: `config`, `gke` (auto-discover), `catalog` (clusters that are catalog
  Resources of type `kubernetes-cluster`), `localKubectlProxy`.
- Per-cluster `authProvider`: `serviceAccount`, `aws`, `google`, `azure`, `oidc`.
- `serviceLocatorMethod`: `multiTenant` (component runs on all clusters), `singleTenant`, `catalogRelation`
  (only clusters the entity `dependsOn`). **This is the pattern DCC needs: the repo declares an ID; the platform
  holds the cluster/credential list; a relation joins them.**

**Auto-discovery** — https://github.com/backstage/backstage/blob/master/docs/integrations/github/discovery.md
- Crawls a GitHub org/App for files at `catalogPath` (default `/catalog-info.yaml`, wildcards/minimatch allowed);
  filters by branch, repo regex, topic, visibility, archived; `validateLocationsExist`; schedule — docs recommend
  ~35 min because of GitHub's 5,000 req/h limit.
- Limit, verbatim from the reading: discovery "works exclusively with catalog-info files — it doesn't infer or discover
  other types of entities beyond what's explicitly defined in these files." Harness IDP's equivalent plugin is the same
  (only finds `catalog-info.yaml`; deprecated in IDP 2.0):
  https://github.com/harness/developer-hub/blob/main/docs/internal-developer-portal/plugins/available-plugins/github-catalog-discovery.md

**Life of an entity / staleness** —
https://github.com/backstage/backstage/blob/master/docs/features/software-catalog/life-of-an-entity.md
- Ingestion (entity providers own disjoint "buckets") → processing (validation, relations) → stitching.
- An entity no longer emitted by its parent becomes an orphan (`backstage.io/orphan: 'true'`) and is **deleted by
  default** (`orphanStrategy: keep` to disable); a provider deletion cascades to the tree it produced.
- Known warts: stale relations remain until re-stitch (issue #20030), catalog cleanup requests (#7860), incremental
  ingestion removal sweep made self-healing (PR #35133) — https://github.com/backstage/backstage/issues/20030 [B].

**Scorecards/nudging** — Tech Insights community plugin: "facts (data points) and checks (rules)" + maturity ranking;
https://github.com/backstage/community-plugins/tree/main/workspaces/tech-insights [A].
**Scaffolder** generates `catalog-info.yaml` and opens a PR against the repo (backstage/software-templates [A];
Roadie blog [C] https://roadie.io/blog/using-backstages-scaffolder-to-fill-up-your-catalog/).
**Permissions** are per-user authorization inside one instance; the docs do not offer tenant isolation:
https://github.com/backstage/backstage/blob/master/docs/permissions/overview.md [A]. (Claude's reading: `metadata.namespace`
is a naming scope, not a wall — a multi-client shop on Backstage relies on a permission policy, not the data model.)
Signal of where catalogs are going: RFC #32062 "Modeling of MCP Servers in the Catalog", closed/completed 2026-05-19 —
https://github.com/backstage/backstage/issues/32062 [A].

### 1.2 Port [A, via search summary — docs.port.io blocked]
- Model = **blueprints** (schemas) with properties and **relations**; entities are instances; integrations ship
  predefined blueprints you can change. https://docs.port.io/build-your-software-catalog/customize-integrations/configure-data-model/
- **Ocean** extensibility framework: each integration fetches a third-party API and maps to blueprints; many come with
  ready-made blueprints (Kubernetes, clouds, ArgoCD, CI tools). https://ocean.port.io/
- **AI catalog auto-discovery**: "uses Port AI to discover entities and their relations … especially for entities that
  are not automatically created through integrations, such as services and users."
  https://docs.port.io/build-your-software-catalog/catalog-auto-discovery/ ; roadmap item "Auto-discovery of relations"
  https://roadmap.getport.io/ideas/p/auto-discovery-of-relations
- Scorecards (rules → levels per blueprint) https://docs.port.io/promote-scorecards/ — *not fetched; description from
  prior knowledge, verify.*
- Relevance: because Port's model is user-defined, a **`Client` blueprint with relations to Environment, Cloud Account,
  Repository, Service** is a normal Port setup — the closest existing product to what DCC needs.

### 1.3 Cortex [A/C]
- Custom entity types and **entity relationships** to "reflect your organization's taxonomy"
  https://www.cortex.io/post/introducing-entity-relationships (via summary).
- `cortex.yaml` is OpenAPI-styled with `x-cortex-*` extensions: `x-cortex-tag`, `x-cortex-owners`, `x-cortex-groups`,
  `x-cortex-domain-parents`, `git`, `links`, custom data. The CLI manages entities, entity types, teams, scorecards,
  **deploys (deployment records with an `environment` field)**, plugins, workflows, integrations —
  https://github.com/cortexapps/cli [A]. So Cortex models an environment as an attribute of a deploy event, not as an entity.
- Ownership hygiene: IdP integrations (Okta, Google, Workday); "displays unowned entities with automated recommendations
  for potential owners" (via summary).

### 1.4 OpsLevel [A]
- Catalog = services, systems, domains, **infrastructure objects**, repos; 40+ integrations (via summary,
  https://www.opslevel.com/resources/catalog-everything-in-your-software-ecosystem).
- Infrastructure Catalog imports objects "across your various IaaS accounts" (AWS, GCP, Azure) and relates them to
  services/systems https://docs.opslevel.com/docs/infrastructure (via summary).
- Terraform provider shows the shape: `opslevel_infrastructure { schema ("Database"...), owner, aliases, data (JSON),
  provider_data { account (required), name (AWS/GCP/Azure), type, url } }` —
  https://github.com/OpsLevel/terraform-provider-opslevel/blob/main/docs/resources/infrastructure.md
  **`provider_data.account` is the only "which account/tenant does this live in" field in any of the four catalogs.**
- Service Detection recommends services from git repos, Datadog/PagerDuty/New Relic/OpsGenie and deploy integrations;
  a human confirms https://www.opslevel.com/resources/build-your-catalog-with-service-detection (via summary).

### 1.5 What the catalogs prove for a multi-client software house
1. **Repo-side descriptor + platform-side inventory + relation** is the industry pattern (catalog-info.yaml / cortex.yaml /
   opslevel.yml ↔ cluster/cloud inventories ↔ annotations). DCC already has `.dcc.json`; the repo file should carry
   identity and build recipe, never targets or credentials. [A]
2. **No catalog has a first-class Environment or Client kind.** Environments are Resources + annotations (Backstage),
   attributes of deploy records (Cortex), `provider_data.account` (OpsLevel), or whatever blueprint you define (Port).
   DCC must define both explicitly. [A]
3. **"Auto-discovery" = declared files + API inventories**; inference is the new, human-confirmed layer. [A]
4. **Staleness is handled by ownership of buckets + orphan deletion + scorecards**, not by hoping humans edit YAML. [A]

---

## 2. Environment / release models — the common data model

### 2.1 GitHub Environments [A]
https://github.com/github/docs/blob/main/content/actions/reference/workflows-and-actions/deployments-and-environments.md
- Protection rules: **required reviewers** (up to 6 users/teams), **wait timer** (1–43,200 min), **deployment
  branch/tag restrictions** (none / protected only / selected patterns), **custom rules via GitHub Apps** (observability,
  change management, code quality), **prevent self-review**, **admin bypass** (on by default, can be disabled);
  at most 6 rules enabled per environment (via summary).
- **Environment secrets** only reach jobs that reference the environment and only after required approval; variables via
  `vars`. Deployment history per environment. Plan gating: most rules need public repo or Enterprise/Team.
- OIDC: each job gets a JWT whose subject can be `repo:octo-org/octo-repo:environment:prod`; the cloud validates claims and
  issues a short-lived token — "No cloud secrets" —
  https://github.com/github/docs/blob/main/content/actions/concepts/security/openid-connect.md

### 2.2 Azure DevOps [A]
- **Environment** = "a logical target where your pipeline deploys software"; resources: Kubernetes, VMs; deployment history
  + traceability of commits/work items; roles Creator/Reader/User/Administrator; pipeline permissions per environment;
  a deployment job targeting a resource "automatically inherit[s] the service connection details from the resource" —
  https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/pipelines/process/environments.md
- **Checks** attach to protected resources (environments, service connections, repositories, variable groups, secure files,
  agent pools): Approvals, Branch control, Business hours, Invoke Azure Function, Invoke REST API, Query Azure Monitor
  alerts, Required template, Evaluate artifact, Exclusive lock. "Before the execution of a stage can begin, all checks on
  all the resources used in that stage must be satisfied." Order: static → pre-approvals → dynamic → post-approvals →
  exclusive lock — https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/pipelines/process/approvals.md
- **Service connections** = "authenticated connections between Azure Pipelines and external or remote services"; they
  "have standing access"; ADO may auto-disable ones unused for 100 days; project-scoped; per-pipeline authorization
  recommended ("Grant access permission to all pipelines … isn't recommended"); types: Azure RM, Kubernetes, GitHub,
  Docker Registry, NuGet/npm/Maven, Jenkins, SSH, Generic, etc. —
  https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/pipelines/library/service-endpoints.md
- **Workload identity federation** for Azure RM connections: OIDC exchange, no secret; ADO issuer
  `https://vstoken.dev.azure.com` retires **2027-07-01** in favor of the Entra issuer; automatic app registration vs
  existing user-assigned managed identity; one-click conversion with a 7-day revert —
  https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/pipelines/library/connect-to-azure.md
- **Variable groups per environment** with one YAML for all stages is the standard practitioner pattern [C]
  (e.g. https://oneuptime.com/blog/post/2026-02-16-how-to-set-up-a-multi-stage-yaml-pipeline-in-azure-devops-with-approval-gates/view).
- Auditing: org-level events, 90-day retention, export or stream (Splunk, Azure Monitor); "View audit log" permission —
  https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/organizations/audit/azure-devops-auditing.md

### 2.3 Octopus Deploy — the only tool with a first-class *tenant* [A]
- Tenants "enable customer or location-specific deployment pipelines without duplicating project configuration"; uses:
  SaaS customers, locations, regions, teams — https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/tenants/index.md
- A tenant is connected to **projects and environments**; per-project tenanted mode (tenants only / optional / disabled);
  one deployment task per tenant×environment; "a tenant is treated like a smaller slice of an environment" —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/tenants/tenant-deployment-faq.md
- **Tenant tags** in tag sets scope steps, variables, targets, channels, accounts; OR within a set, AND across sets; e.g.
  Upgrade Ring = Tester/Early Adopter/Stable —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/tenants/tenant-tags.md
- **Tenant variables**: *project templates* (per tenant **per environment** — "a connection string or a database server")
  vs *common variables* (library variable set templates — constant per tenant across projects and environments); templates
  have defaults, control types, required flags; "We don't take a snapshot of tenant variables" so new tenants deploy
  without a new release — https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/tenants/tenant-variables.mdx
- **Tenant infrastructure**: targets are *excluded from tenanted* (default) / *tenanted only* / *both*; associated by direct
  selection or tags; dedicated vs shared hosting —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/tenants/tenant-infrastructure.md
- Octopus' own guidance for a vendor with many customers: **one tenant per customer; require a tenant on every
  deployment; tag sets for release rings and feature flags; project template variables with defaults; targets named
  `[Environment]-[Tenant]-[App]-[Component]-[Number]`; automate tenant variables through the API** —
  https://github.com/OctopusDeploy/OptimumSetupBook/blob/master/manuscript/MultiTenancyApps.md
- Health: machine policies (never/interval/cron; full vs connection-only), statuses **healthy / healthy with warnings /
  unhealthy / unavailable**, custom scripts, auto-delete unavailable machines after a period —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/infrastructure/deployment-targets/machine-policies.mdx ;
  project setting "skip unavailable, or exclude unhealthy targets" —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/projects/setting-up-projects.md
- **Cloud target discovery**: Azure Web Apps/App Service/AKS, AWS ECS/EKS found **at deployment time** from resource tags
  `octopus-environment` and `octopus-role` (required), `octopus-space/project/tenant/tenantedDeploymentMode` (optional);
  humans still supply the account variable, regions, worker pool; "Renaming or moving cloud resources can cause target
  discovery to create duplicate targets"; unhealthy discovered targets removed after five failed health checks —
  https://github.com/OctopusDeploy/docs/blob/main/src/pages/docs/infrastructure/deployment-targets/cloud-target-discovery/index.md

### 2.4 Harness CD [A]
- **Service** (service definition: artifacts, manifests, config files, variables) · **Environment** ("where you are
  deploying"; type **Production / PreProduction**) · **Infrastructure Definition** ("the specific VM, Kubernetes cluster, or
  target infrastructure") referencing a **Connector** · override precedence: service-specific environment overrides >
  environment configuration > service settings · scope account/org/project · **environment groups** for permissions —
  https://github.com/harness/developer-hub/blob/main/docs/continuous-delivery/x-platform-cd-features/environments/environment-overview.md
- "Scope to specific services" on an infrastructure definition; "the service Deployment Type must match the infrastructure
  definition Deployment Type" —
  https://github.com/harness/developer-hub/blob/main/docs/continuous-delivery/x-platform-cd-features/environments/scope-infra-to-services.md
  **→ this is the cleanest published answer to "different tool per environment": the deploy mechanism is a property of
  the infrastructure definition's type, and a service can only bind to compatible ones.**

### 2.5 Argo CD / ApplicationSets [A]
- Generators: list, **cluster**, git (directory/file), matrix, merge, SCM provider, pull request, cluster decision resource,
  plugin, OCI — https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/applicationset/Generators.md
- Clusters are Secrets labeled `argocd.argoproj.io/secret-type: cluster`; the generator emits `name`, `nameNormalized`,
  `server`, `project`, `metadata.labels/annotations`; label selectors (e.g. `staging: "true"`); it reacts to cluster
  additions/removals — https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/applicationset/Generators-Cluster.md
- Promotion is modeled as Application-per-env, ApplicationSet-per-env, or one ApplicationSet over labeled clusters [B/C]
  (https://codefresh.io/learn/argo-cd/argocd-applicationset-multi-cluster-deployment-made-easy-with-code-examples/).

### 2.6 The common model (extracted)
Every tool above reduces to the same six objects; only Octopus adds the seventh:

| Object | GitHub | Azure DevOps | Octopus | Harness | Argo CD | Power Platform |
|---|---|---|---|---|---|---|
| **Project / deployable** | repo + workflow | pipeline | project | service | Application(Set) | solution |
| **Environment** (ordered stage with gates) | environment + protection rules | environment + checks | environment (lifecycle) | environment (Prod/PreProd) | label on cluster / app per env | environment (dev/sandbox/prod) + pipeline stage |
| **Target / infrastructure** | (implicit in job) | environment resource (VM, K8s) | deployment target (+ health) | infrastructure definition (+ deployment type) | cluster Secret (+ labels) | environment URL / org |
| **Credential (opaque, referenced)** | env secrets / OIDC | service connection (+ WIF) | account / certificate | connector | cluster secret | service connection / application user (SPN, WIF) |
| **Settings per (project × env [× tenant])** | env vars/secrets | variable group | tenant + project variables | env/service overrides | values per cluster | deployment settings JSON (connection refs, env vars) |
| **Process** | workflow YAML | multi-stage YAML | deployment process (steps scoped by tag/role) | pipeline | sync policy | Build Tools tasks / pipeline stages |
| **Tenant** | — | — | **first-class** | (labels) | (labels/matrix) | — (per-environment settings do the job) |
| **Deployment record** | deployment history | environment history | deployment task | execution | sync status | run history + auto backup |

---

## 3. Microsoft Dynamics 365 / Dataverse / Power Platform ALM [A]

### 3.1 Solutions and layering
- "Unmanaged solutions are used in development environments while you make changes"; **exported unmanaged versions are
  what you check into source control**; managed = build artifact for every non-dev environment; "You can't edit components
  directly within a managed solution"; deleting a managed solution removes its customizations; publisher prefix avoids
  naming conflicts; operations create/update/upgrade/patch —
  https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/solution-concepts-alm.md
- Layering: managed layers stack in install order over the system layer; **the unmanaged layer is one shared layer on
  top**; only model-driven app, form and sitemap merge — everything else is "top level wins" → unmanaged edits in prod
  mask managed upgrades — https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/solution-layers-alm.md

### 3.2 Environments
- Types: **Production**, **Sandbox** (copy/reset; dev/test), **Developer** (owner-only), **Trial** (30 days), **Default**,
  **Dataverse for Teams**. Each has a region, a **unique URL**, optional Dataverse DB, Environment Admin/Maker roles —
  https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/admin/environments-overview.md
- **Application user**: Entra app registration → PPAC → environment → Application users → assign security role
  (System Administrator for ALM); "You can create an unlicensed application user"; **one application user per app
  registration per environment** — https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/admin/manage-application-users.md

### 3.3 `pac` CLI
- `pac auth create`: `--environment`, `--username/--password`, `--applicationId/--clientSecret/--tenant`,
  `--certificateDiskPath`, `--managedIdentity`, `--deviceCode`; **no on-premises option is documented** —
  https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/developer/cli/reference/auth.md
- `pac solution`: export (`--managed`, `--async`, `--include`), import (`--activate-plugins`, `--async`,
  `--force-overwrite`, `--import-as-holding`, `--publish-changes`, `--settings-file`, `--stage-and-upgrade`), pack/unpack,
  clone, upgrade, version, check, add-reference, **create-settings** ("a .json file with the deployment settings for
  connection references and environment variables") —
  https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/developer/cli/reference/solution.md
- Deployment settings file: `EnvironmentVariables[{SchemaName, Value}]`, `ConnectionReferences[{LogicalName, ConnectionId,
  ConnectorId}]`; generated empty, **populated by hand per target environment because connection IDs differ per
  environment** — https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/conn-ref-env-variables-build-tools.md
- `pac plugin init` / `pac plugin push --pluginId --pluginFile --type Nuget|Assembly --environment` ("Import plug-in into
  Dataverse") — https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/developer/cli/reference/plugin.md
- `pac pipeline list` / `pac pipeline deploy --stageId --solutionName --currentVersion --newVersion [--wait]` —
  https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/developer/cli/reference/pipeline.md
- The CLI reference has no `mcp` command group (it has `copilot`, `copilot-studio`, `workflows-agent`) —
  https://github.com/MicrosoftDocs/power-platform/tree/main/power-platform/developer/cli/reference

### 3.4 Plug-in registration: PRT vs `pac`
- PRT flow: register **assembly** → **step** (table, message, stage PreValidation/PreOperation/PostOperation, mode sync/async)
  → **images**. Critical: "Any existing or subsequent step registrations … aren't added to the unmanaged solution that
  includes the plug-in assemblies. You must add each registered step to the solution separately." —
  https://github.com/MicrosoftDocs/powerapps-docs/blob/main/powerapps-docs/developer/data-platform/register-plug-in.md
- Plug-in **packages** (NuGet with dependent assemblies): no strong-naming needed, stored in `PluginPackage`, uploaded by
  `pac plugin push` or PRT, must still be added to a solution, **"Not supported on-premises or for workflow extensions"**;
  assemblies must target .NET Framework (`net462`) —
  https://github.com/MicrosoftDocs/powerapps-docs/blob/main/powerapps-docs/developer/data-platform/build-and-package.md
- So: `pac plugin push` replaces the *assembly upload* click in PRT; **step/image registration is still PRT (or spkl
  attributes) and must be captured in the solution** — a hidden prerequisite DCC must model as a check.

### 3.5 Automation options and their status (Sept 2026)
| Tool | What it is | Status | Source |
|---|---|---|---|
| Power Platform Build Tools (ADO) | v2, pac-CLI based; tasks: Tool Installer, WhoAmI, Checker, Import/Export/Pack/Unpack, Add Solution Component, Apply Solution Upgrade, Delete, Publish Customizations, Set Solution Version, Set Connection Variables, Deploy Package, Create/Delete/Reset/Backup/Copy/Restore Environment, Assign User, Export/Import Dataverse Data, Power Pages, Catalog | supported | https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/devops-build-tool-tasks.md |
| — service connection types | **SPN via workload identity federation (recommended, MFA-safe)**, SPN + client secret, username/password (no MFA) | supported | https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/devops-build-tools.md |
| GitHub Actions for Power Platform | same four categories; SPN or username/password; Windows and Linux runners | supported | https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/devops-github-actions.md |
| Power Platform Pipelines | host environment stores artifacts; sequential stages, same artifact; targets must be Managed Environments (auto-enabled from Feb 2026); delegated deployments with a **per-stage service principal**; deployment settings for connection refs/env vars; pre-export / pre-deployment / deployment-completed extension events; limits: one dev env per solution, **no cross-tenant**, no multi-solution batch, managed-only to non-dev; auto backup + redeploy previous | GA, Microsoft's recommended path | https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/alm/pipelines.md |
| ALM Accelerator (CoE kit) | canvas app + ADO YAML/PowerShell templates, unpacked solutions in git, profiles per environment | **deprecated 2026-04-21; issues no longer reviewed; move to Pipelines** | https://github.com/MicrosoftDocs/power-platform/blob/main/power-platform/includes/guidance-deprecate-alm-accelerator.md |
| spkl | task runner; `spkl.json` declares plugins, workflows, webresources, earlybound, solutions; `CrmPluginRegistration` attributes put step registration in code; profiles + stored connection strings (ClientSecret) | wiki last edited 2022-03-11; 202 open issues → treat as unmaintained | https://github.com/scottdurow/SparkleXrm/wiki/spkl |
| XrmToolBox | Windows GUI, 30+ plugins, on-prem and online | active, GPL-3 | https://github.com/MscrmTools/XrmToolBox |

### 3.6 Recommended dev → test → prod flow (synthesized from the [A] docs above)
1. Dev (unmanaged, one dev environment per solution): developer builds plug-in → `pac plugin push` (or PRT) → registers
   steps in PRT/spkl → adds assembly **and steps** to the unmanaged solution → `pac solution export` (unmanaged) →
   `pac solution unpack` → commit.
2. Build: `pac solution pack` → export as **managed** from the dev environment (or pack managed) → Checker → artifact.
3. Test/UAT/Prod: `Import Solution` (managed, `--async`, `--settings-file <env>.json`, holding/stage-and-upgrade for
   upgrades) → publish → smoke. Gates = ADO environment checks or Power Platform pipeline approvals.
   Or: Power Platform pipelines (host env, stageIds, delegated SPN) triggered by `pac pipeline deploy`.

### 3.7 What a delivery platform must know to deploy (Dataverse online)
Per environment: environment URL + ID, type, region, Entra tenant ID, auth method (SPN secret / cert / WIF / managed
identity), app registration client ID, **application user + role present**, Managed Environment flag, pipelines host +
stageId if used. Per solution: unique name, publisher prefix, version scheme, managed-vs-unmanaged per stage,
**deployment-settings JSON per target** (connection IDs, env variable values), plug-in assemblies/packages **and their
steps** in the solution, upgrade policy (update / holding+upgrade), publish policy, checker ruleset/threshold.

### 3.8 The on-premises variant (Dynamics 365 CE on-premises 9.x)
- Plug-in storage: **database (recommended; auto-distributed across the cluster)** vs on-disk (copy to
  `<installdir>\Program Files\Microsoft CRM\server\bin\assembly` on **each** server *before* registering) vs GAC for
  referenced assemblies; sandbox plug-ins must be in the DB; non-isolated registration needs the **Deployment Administrators**
  group (Deployment Manager); sandbox registration needs System Administrator —
  https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/customerengagement/on-premises/developer/register-deploy-plugins.md
- Auth for tools (Xrm.Tooling connection strings): `AuthType=AD` (domain creds), `AuthType=IFD` (AD FS, `HomeRealmUri`),
  `AuthType=OAuth` ("ADFS 3.x+ and App\Client Id registration with ADFS is required"); `Office365` is online-only —
  https://github.com/MicrosoftDocs/dynamics-365-customer-engagement/blob/main/ce/customerengagement/on-premises/developer/xrm-tooling/use-connection-strings-xrm-tooling-connect.md
- Plug-in packages unsupported on-prem (§3.4); `pac auth` documents no on-prem mode (§3.3). *Claude's inference:* on-prem
  automation = SolutionPackager/Xrm.Tooling/PRT/spkl over AD/IFD credentials, run from a machine inside the network —
  which is why DCC needs a **runner location** attribute per target and a place for domain credentials it cannot federate.

---

## 4. AI discovery of a client's landscape

**What exists and what it actually infers**
| Capability | What it reads | What it infers | Human still supplies | Grade / source |
|---|---|---|---|---|
| Backstage / Harness IDP discovery | `catalog-info.yaml` in repos | nothing beyond the file | everything in the file | [A] §1.1 |
| Port AI auto-discovery | integration data + AI | entities and **relations** not created by integrations (services, users) | approval/curation | [A via summary] https://docs.port.io/build-your-software-catalog/catalog-auto-discovery/ |
| OpsLevel Service Detection | git repos, monitors, deploy events | candidate services | confirm | [A via summary] |
| Octopus cloud target discovery | Azure/AWS resource tags at deploy time | targets, roles, environment, tenant | account, regions, worker pool, tag discipline | [A] §2.3 |
| Argo cluster generator | cluster Secrets + labels | Applications per cluster | registering clusters, labels | [A] §2.5 |
| Azure Copilot Deployment Agent | conversation; **greenfield only**, "doesn't currently support importing or modifying existing infrastructure" | plan + Bicep/Terraform + PR | requirements, choices | [A] https://github.com/MicrosoftDocs/azure-management-docs/blob/main/articles/copilot/deployment-agent.md ; same skill shipped for Claude Code/Copilot/Cursor (via summary) |
| azd + Copilot | project structure | proposes `azure.yaml`, infra files | confirm | [A via summary] https://devblogs.microsoft.com/azure-sdk/azd-copilot-integration/ |
| GitHub Copilot app-modernization agent | repo | infra provisioning, containerization, deployment | approve | [A via summary] https://learn.microsoft.com/en-us/azure/developer/github-copilot-app-modernization/modernization-agent/infra-deployment |
| Claude Code `/init` and plan mode | repo, CI configs, env-var usage | starter CLAUDE.md; a plan | commands "Claude can't guess", env quirks | [A] https://code.claude.com/docs/en/best-practices |
| Practitioner scanners (DeployRA, InfraAudit, .NET+Ollama Backstage generator) | Dockerfiles, CI YAML, IaC, appsettings | stack detection, generated CI/Dockerfiles/catalog YAML | owner, lifecycle, system | [C] https://github.com/Swapnil454/Deployraai , https://deploypilotai.automationvijay.site/ , https://blog.bgener.nl/blog/ai-backstage-ollama/ |
| Study: agents touching CI/CD YAML | 8,031 agentic PRs, 1,605 repos, five agents (Copilot, Cursor, Devin, Claude Code, Codex) | frequency and success of CI-config edits by agents | — | [B] https://arxiv.org/html/2601.17413v1 (abstract not retrievable through the proxy; numbers from the search summary only) |

**Anthropic's own guidance relevant to DCC's onboarding** [A] https://code.claude.com/docs/en/best-practices
- CLAUDE.md should hold "Bash commands Claude can't guess", "developer environment quirks (required env vars)",
  "repository etiquette", and exclude "anything Claude can figure out by reading code" and "information that changes
  frequently" — i.e. **environment URLs, secrets and per-client settings do not belong in the repo file**.
- "Explore first, then plan, then code" with plan mode; example prompt literally asks Claude to "look at how we manage
  environment variables for secrets" — reading CI/config is expected and safe in plan mode.
- CLI tools (`gh`, `aws`, `gcloud`) are "the most context-efficient way to interact with external services"; Claude "is
  also effective at learning CLI tools it doesn't already know" (`--help`).
- MCP page: project-scope `.mcp.json` servers need approval; enterprise `allowedMcpServers`/`deniedMcpServers`; per-tool
  `ask`/`blocked`; credential env vars are never expanded toward remote servers — https://code.claude.com/docs/en/mcp

**Hard limits (what cannot be discovered)** — each backed by a vendor statement:
- **Secret values** (by design absent from repos and unreadable from ADO/GitHub APIs); GitHub OIDC/ADO WIF exist precisely
  so nothing to discover exists [A] §2.1–2.2.
- **Per-environment IDs that live only in the target**: Dataverse connection IDs and environment variable values must be
  "manually populated" per environment [A] §3.3; Octopus discovery still needs the account and regions [A] §2.3.
- **Which environment belongs to which client, and its rank in promotion** — a label, not a fact in code.
- **Organizational agreements**: who approves prod, change windows, self-review rules, business hours — configured as
  protection rules/checks in GitHub/ADO (API-readable once set, never inferable).
- **On-prem topology and identities** (server list, Deployment Administrators, AD FS) [A] §3.8.
- **Existing infrastructure semantics**: the Azure agent is explicitly greenfield-only [A].

---

## 5. MCP for CI/CD and clouds — status September 2026

| Server | Hosting / endpoint | Auth model | Scope | Status | Source |
|---|---|---|---|---|---|
| **Azure DevOps** (microsoft/azure-devops-mcp) | remote `https://mcp.dev.azure.com/{organization}`; local stdio | Entra OAuth; "OAuth scopes don't override the permissions of the signed-in user" | work items, repos, pipelines/builds, wiki, test plans, search, advanced security | Remote **GA Aug 2026** (sprint 278) with audit events; docs list VS/VS Code Copilot, Foundry, Copilot Studio, Copilot CLI/app, Cursor, "Claude Code with a custom Microsoft Entra app registration"; **Claude Desktop and Codex unsupported** (no Entra auth flow / no dynamic client registration) → local server. README still says "preview" and warns of tool renames. | [A] https://github.com/MicrosoftDocs/azure-devops-docs/blob/main/docs/mcp-server/remote-mcp-server.md , https://github.com/microsoft/azure-devops-mcp , https://learn.microsoft.com/en-us/azure/devops/release-notes/2026/sprint-278-update (via summary) |
| **Azure** (microsoft/mcp) | local stdio; remote HTTP | local: DefaultAzureCredential chain (env, VS/VS Code, Azure CLI/PowerShell, azd, browser), `AZURE_TOKEN_CREDENTIALS` pin, SPN env vars, Azure Pipelines WIF; remote: inbound Entra bearer with `Mcp.Tools.ReadWrite[.All]`, outbound **on-behalf-of** or hosting managed identity | ARM + services | shipping | [A] https://github.com/microsoft/mcp/blob/main/docs/Authentication.md |
| **AWS MCP Server** (managed) | `https://aws-mcp.us-east-1.api.aws/mcp` (+ eu-central-1) | **SigV4 under the caller's IAM identity**; CloudTrail logging; IAM guardrails | 15,000+ API operations, docs, skills | **GA 2026-05-06**; MCP Proxy for AWS GA 2025-10-31; open-source per-service servers (IaC/CDK, EKS, ECS, Lambda, IAM…) use local profiles | [A] https://github.com/awslabs/mcp , https://aws.amazon.com/blogs/aws/the-aws-mcp-server-is-now-generally-available/ (via summary) |
| **Google Cloud** (managed) | remote, 50+ servers (GKE, Cloud Run, GCE, Logging, Monitoring, BigQuery, Cloud SQL, Pub/Sub, GCS, Workspace…) | Cloud IAM + Deny policies; Model Armor; Cloud Audit Logs | infra + data | announced **2026-04-29**, GA/preview mix | [A] https://cloud.google.com/blog/products/ai-machine-learning/google-managed-mcp-servers-are-available-for-everyone |
| **GitHub** | remote `https://api.githubcopilot.com/mcp/`; local Docker (GHES needs local + GitHub App) | OAuth 2.1 + PKCE or PAT; `--read-only`; toolsets (repos, issues, pull_requests, actions, code_security, secret_protection, projects…); org policy "MCP servers in Copilot" | SCM + Actions | remote GA 2025-09-04; scope filtering Jan 2026 | [A] https://github.com/github/github-mcp-server , https://github.blog/changelog/2025-09-04-remote-github-mcp-server-is-now-generally-available/ (via summary) |
| **Kubernetes** (containers/kubernetes-mcp-server) | local Go binary / in-cluster / Helm | kubeconfig, in-cluster, OIDC (Keycloak, Entra); read-only mode; denied resources (e.g. Secrets); multi-cluster | CRUD, pods, Helm, Tekton | mature (2.1k stars, 100+ eval scenarios) | [A] https://github.com/containers/kubernetes-mcp-server |
| **Jenkins** (jenkinsci/mcp-server-plugin) | plugin endpoints `/mcp-server/{sse,mcp,stateless}` | HTTP Basic with API token | getJobs, triggerBuild, getBuildLog, searchBuildLog, rebuild/replay, test results, SCM info | production-ready, spec 2025-06-18 | [A] https://github.com/jenkinsci/mcp-server-plugin |
| **Octopus** | OctopusDeploy/mcp-server (local) → **Remote MCP Server built into Octopus Server 2026.3+** | API key env var; write on by default, `--read-only`, `--allow-deletes` | projects, environments, tenants, releases, deployments, tasks, variables, REST backstop | local server **deprecated** in favor of remote | [A] https://github.com/OctopusDeploy/mcp-server |
| **Dataverse** | remote per environment `https://{org}.crm.dynamics.com/api/mcp`; enabled and client-allowlisted per environment in PPAC | user identity + Dataverse RBAC; governance in PPAC | 14 tools: data (search/read/create/update/delete), schema (create/update/delete table), skills, files — **no solution/ALM tools** | supported in Copilot Studio, Foundry, VS Code Copilot, Copilot CLI, Claude Desktop, Claude Code | [A] https://github.com/MicrosoftDocs/powerapps-docs/blob/main/powerapps-docs/maker/data-platform/data-platform-mcp.md , https://www.microsoft.com/en-us/power-platform/blog/2026/06/08/dataverse-mcp-server-understanding-the-new-tool-shape/ |
| **Power Platform ALM MCP** | — | — | — | **none found** (pac CLI has no mcp group; July 2026 Dataverse blog mentions none) | [A] §3.3 |

**Protocol maturity.** The 2026-07-28 revision: stateless request/response ("any request can now land on any instance
behind a plain round-robin load balancer"), Tasks as an official extension, RFC 9207 issuer validation, **Dynamic Client
Registration deprecated in favor of Client ID Metadata Documents**, multi-round-trip requests, header-based routing,
12-month deprecation policy — https://blog.modelcontextprotocol.io/posts/2026-07-28/ [A]. Authorization = OAuth 2.1 with
the MCP server as resource server, RFC 9728 protected-resource metadata, RFC 8707 resource indicators; enterprise-managed
authorization (ID-JAG via RFC 8693 token exchange) stabilized June 2026 [B/C: https://www.descope.com/blog/post/mcp-auth-spec ,
https://aembit.io/blog/mcp-oauth-2-1-pkce-and-the-future-of-ai-authorization/]. The Entra gap that keeps Claude Desktop off the
ADO remote server is exactly this registration problem [A].

**When MCP beats a direct API integration in DCC** (evidence-based rule):
- **Use MCP when a person is in the loop and the action should be attributed to them**: the ADO, AWS, Google and Dataverse
  servers all execute under the *caller's* identity and permissions and log to the vendor's audit trail — this satisfies
  DCC's "identity is always a real person" decision for exploratory/diagnostic work inside a Claude Code session
  (read a failed pipeline, inspect a deployment, query work items). [A]
- **Use direct API / CLI for DCC's own deterministic steps** (export/import a solution, trigger a stage, promote): the
  Dataverse MCP has no ALM tools; Octopus' MCP writes by default and is being replaced; ADO remote MCP is still
  consolidating tool names; background jobs need a service identity (WIF), idempotency and typed errors — none of which
  MCP gives. Anthropic's guidance also ranks CLIs as the most context-efficient path. [A]
- **Never let an MCP server be the place a client credential is stored**: Azure MCP remote uses OBO or a hosting identity;
  Claude Code refuses to expand credential env vars toward remote servers. [A]

---

## 6. Secrets for a multi-tenant platform that acts on clients' systems

- **Multitenant identity guidance (Azure Architecture Center)**: use federation, workload identities with certs/keys and
  automated rolling, and *never store customer credentials directly* —
  https://github.com/MicrosoftDocs/architecture-center/blob/main/docs/guide/multitenant/considerations/identity.md [A]
- **Key Vault per tenant**: three models — vault per tenant in the provider's subscription (high isolation; "Azure doesn't
  limit the number of vaults … within a single subscription" but subscription-wide request limits apply), **vault per
  tenant in the customer's subscription** (customer-managed keys; the customer grants a multitenant Entra app access),
  shared vault with tenant-ID-prefixed names (low isolation) —
  https://github.com/MicrosoftDocs/architecture-center/blob/main/docs/guide/multitenant/service/key-vault.md [A]
- **Azure Lighthouse** — the pattern for a software house on many clients' Azure: the customer delegates subscriptions or
  resource groups to *named users/roles in the provider tenant*; "Users can see what changes were made and by whom in the
  customer tenant's activity log"; the customer "can remove access completely at any time"; no cost; not across national
  clouds — https://github.com/MicrosoftDocs/azure-management-docs/blob/main/articles/lighthouse/overview.md [A]
- **Entra workload identity federation**: federated identity credentials on app registrations or user-assigned managed
  identities; issuer/subject/audience must match exactly; scenarios: GitHub Actions, Azure Pipelines, Kubernetes, AWS/GCP,
  SPIFFE; only the first 100 IdP signing keys are stored —
  https://github.com/MicrosoftDocs/entra-docs/blob/main/docs/workload-id/workload-identity-federation.md [A]
- **ADO service connections with WIF** (no stored secret; issuer migration to Entra by 2027-07-01) [A] §2.2;
  **GitHub OIDC** subject includes the environment (`repo:org/repo:environment:prod`) so a cloud role can be bound to *one
  environment of one repo* [A] §2.1; **GitHub App installation tokens** expire after one hour and are scoped to the
  installation's repos/permissions — the right way for DCC to act on many orgs —
  https://github.com/github/docs/blob/main/content/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app.md [A]
- **Power Platform**: Build Tools recommend SPN via WIF; application users are unlicensed and one per app per environment;
  pipelines' delegated deployments use a per-stage SPN so makers never hold prod credentials [A] §3.
- **HashiCorp Vault Enterprise namespaces**: "an isolated environment with separate login paths that functions as a
  mini-Vault"; each has its own secret engines, auth methods, policies, entities, tokens; hierarchy with delegate admins;
  global policies still enforceable — https://github.com/hashicorp/web-unified-docs/blob/main/content/vault/v1.21.x/content/docs/enterprise/namespaces/index.mdx [A];
  tenant-scoped credential vending on EKS — https://aws.amazon.com/blogs/apn/saas-data-isolation-with-dynamic-credentials-using-hashicorp-vault-in-amazon-eks/ [A via summary].
- **Auditing sources DCC can subscribe to or link**: ADO audit log (90 days; stream to Azure Monitor/Splunk) [A];
  customer activity log under Lighthouse [A]; CloudTrail (AWS MCP) [A]; Cloud Audit Logs (Google MCP) [A]; Vault audit
  devices per namespace [A via summary]. DCC's event log should record every *use* of a credential reference
  (who, which target, which run) — never a value.

**"The platform never sees the credential" — the pattern, assembled from the above**
1. DCC has one Entra app (multitenant) + a user-assigned managed identity for its runners. Each client either consents to
   the app / delegates via Lighthouse (Azure), adds it as an **application user** per Dataverse environment, installs
   DCC's **GitHub App**, or creates a **service connection** in their ADO project that DCC's pipelines are authorized to use.
2. Everything that can federate does (WIF/OIDC): no value exists to store.
3. What cannot federate (on-prem AD/IFD passwords, D365 on-prem service accounts, Octopus API keys, Jenkins tokens) lives
   in a **per-client vault** (Key Vault per client, or Vault namespace per client); DCC stores the *reference URI*, the
   identity allowed to read it, scope, expiry, last-rotated, last-used.
4. Runners read at run time under their managed identity; agent sessions use the human's OAuth identity to remote MCP
   servers; DCC logs the use as an event.

---

## 7. Keeping the model current — drift detection and nudging

| Product | Mechanism | How the human is nudged | Source |
|---|---|---|---|
| HCP Terraform | **health assessments**: drift detection ("whether your real-world infrastructure matches your Terraform configuration") + continuous validation; scheduled a set period after the last apply/assessment; never interrupts runs | workspace notifications; two sanctioned remedies — **revert infrastructure** (re-apply) or **update configuration** (accept the drift) | [A] https://github.com/hashicorp/web-unified-docs/blob/main/content/terraform-docs-common/docs/cloud-docs/workspaces/health.mdx |
| Octopus | machine policies (never/interval/cron), four health statuses, auto-delete unavailable machines after N; discovery at deploy time; discovered targets removed after five failed checks | status on Infrastructure → Deployment Targets; project setting to skip unavailable / exclude unhealthy | [A] §2.3 |
| Backstage | providers own buckets; orphans annotated and auto-deleted; Tech Insights checks/maturity | orphan badge; failing checks on the entity page | [A] §1.1 |
| Port | scorecards (rules → levels); AI auto-discovery fills gaps | scorecard levels on entity pages/dashboards | [A via summary / not fetched] |
| Cortex | unowned/orphaned entity detection with owner recommendations; scorecards | "Ownership" view listing unowned entities | [A via summary] |
| Azure DevOps | service connections auto-disabled after 100 days unused; WIF issuer retirement with a hard date; environment deployment history | connection shows disabled; pipeline prompts "needs permission to access a resource" | [A] §2.2 |
| GitHub | deployment history per environment; protection rules | required-reviewer prompt on the run | [A] §2.1 |
| Power Platform | Managed Environments auto-enabled on pipeline targets (Feb 2026); pipelines keep run history and backups | admin center governance | [A] §3.5 |

**Design implication for DCC (synthesis).** Treat the client model like Terraform state: every attribute has a *declared*
value (entered by a human or proposed by the AI and confirmed) and an *observed* value with a timestamp from a probe
(`pac org who`, ADO `GET environments`, Octopus health, GitHub `GET /environments`, a TCP/HTTPS reachability check for
on-prem). Compute drift; write every probe as an event; surface "last verified N days ago", "unreachable since", "service
connection missing", "solution version in prod ≠ last deployed" as "i"-explained cards; offer the Terraform pair of
remedies — *accept* (update declaration) or *fix* (re-run). Auto-disable stale credentials references after an inactivity
window, as ADO does, instead of silently keeping them.

---

## 8. A candidate data model for DCC

All tenant rows carry `client_id` + RLS (existing decision). Names are proposals; fields marked (D) are discoverable by
AI/probes, (H) must come from a human, (P) probed/observed.

**Client** — `id`, `name`, `entra_tenant_id` (H), `identity_mode` (lighthouse | multitenant-app | per-client-spn | github-app | ado-service-connection) (H), `vault_ref` (Key Vault URI or Vault namespace) (H), `related_systems[]` (ADO org, GitHub org, Octopus space, Jenkins URL, PPAC tenant) (H, then P), `contacts/approvers[]` (H), `change_windows` (H).

**Environment** (per client) — `id`, `client_id`, `name` (dev/test/uat/prod…), `rank` (promotion order) (H), `kind` (dataverse-online | dataverse-onprem | azure | aws | gcp | onprem-host | kubernetes) (D/H), `type_tag` (Production / PreProduction, mirroring Harness/Dataverse sandbox-vs-prod) (H), `region` (P), `gates[]` (approvers, wait, branch rule, business hours, self-review) (H), `settings_ref` (variable group / deployment-settings file / tenant variables) (H), `managed_flag` (Dataverse Managed Environment) (P).

**Target** (a concrete thing inside an environment; Harness "infrastructure definition", Octopus "deployment target") — `id`, `environment_id`, `target_type` (dataverse-env | dataverse-onprem-org | azure-subscription/resource-group | aws-account/cluster | gke/aks/eks | vm-host | octopus-project-env | k8s-cluster) (D/H), `address` (URL / org / subscription id / cluster server) (D/H), `deployment_type` (solution-import | plugin-push | helm | terraform | msbuild-publish | container | pipeline-trigger) (D/H), `credential_ref` (H), `runner_location` (cloud | client-network) (H), `health` {status, last_checked, last_error} (P), `discovered_from` (tag / API / human) (P).

**CredentialRef** — `id`, `client_id`, `kind` (wif | oidc | managed-identity | spn-secret | spn-cert | github-app-installation | ado-service-connection | octopus-account | ad-password | ifd | api-key), `vault_uri` (never a value) (H), `principal` (app id / service connection name / installation id) (H/D), `allowed_readers[]` (H), `scope` (H), `expires_at`, `last_rotated`, `last_used`, `disabled_after_days` (policy).

**Deployable** (what a repo produces) — `id`, `repo_id`, `name`, `artifact_kind` (dataverse-solution | plugin-assembly/package | web-resources | container-image | msbuild-package | android-app | terraform-module) (D), `build_recipe` {tool (msbuild | dotnet | gradle | pac | npm | docker), command, ci_file, working_dir} (D), `solution` {unique_name, publisher_prefix, version_scheme, managed_per_stage} (D/H), `plugin_steps_in_solution_check` (P), `settings_template` (deployment-settings JSON schema from `pac solution create-settings`) (D).

**Process** (how a Deployable reaches a Target type; the "different tool per environment" table) — `id`, `deployable_id`, `target_type`, `tool` (pac-build-tools-task | pac-cli | pp-pipeline stageId | github-actions-pp | octopus-project | argo-appset | jenkins-job | prt-manual | spkl), `steps[]`, `preconditions[]` (application user present; Managed Environment; service connection authorized; steps in solution), `verify` (WhoAmI / checker / smoke), `manual_steps[]` (explicit — e.g. PRT step registration on on-prem).

**Promotion** (per Deployable) — ordered list of (Environment, Process, gate policy); `same_artifact_required` (true for Power Platform pipelines), `rollback_policy`.

**Binding** (repo ↔ client landscape, the onboarding join) — `repo_id`, `client_id`, `deployable_id`, `environments[]` it may reach, `default_dev_target`.

**ProbeResult / DriftEvent** (append-only, via `appendEvent`) — `target_id | credential_ref_id | environment_id`, `observed` {…}, `declared_hash`, `drift[]`, `probe_kind`, `actor`, `ts`.

**RelatedSystem** — `client_id`, `kind` (ado-org | github-org | octopus-space | jenkins | ppac-tenant | key-vault | lighthouse-delegation), `address`, `credential_ref`, `mcp_endpoint` (optional, for human-in-the-loop sessions), `api_mode` (mcp | rest | cli).

---

## 9. What is discoverable by AI vs must come from a human

**Discoverable by an agent reading the repo (during onboarding, propose-then-confirm)** [A: Backstage discovery limits;
Anthropic best practices; azd/Copilot; practitioner scanners]
- Build tool and commands (`.csproj/.sln` → MSBuild/dotnet; `build.gradle` → Android; `package.json`; `Dockerfile`).
- Artifact kind: `.cdsproj`/`Solution.xml` → Dataverse solution; plug-in projects (`Microsoft.CrmSdk.CoreAssemblies`,
  `IPlugin`) → plug-in assembly/package; `spkl.json` → plug-ins/web resources/steps declared in attributes.
- CI topology: stage names, environment names referenced in YAML (`environment:` in GitHub/ADO), service connection
  *names*, variable group *names*, Power Platform Build Tools task usage, `pac` commands, Octopus/Argo/Helm references.
- Existing deployment-settings templates (connection reference logical names, environment variable schema names).
- Which environment kinds exist (Dataverse vs Azure vs AWS) and a *draft* promotion order.

**Discoverable by probing the client's systems with a granted identity (after consent, continuously)** [A: ADO environments,
Octopus discovery, Dataverse admin/`pac org`, GitHub environments API, cloud MCP servers]
- The real list of environments and their URLs/IDs/regions/types; Managed Environment flags; application users present;
  ADO environments, checks, service connections (metadata, not secrets); GitHub environments and protection rules;
  Octopus projects/environments/tenants/targets and health; cluster inventories via labels/tags; installed solution
  versions per environment.

**Must come from a human (client-level config, before or independent of any repo)** [A: deployment-settings doc; Octopus
discovery prerequisites; Azure agent greenfield-only; identity guidance]
- Identity and consent: Lighthouse delegation, app consent, application users, GitHub App installation, service connection
  authorization; the vault location per client.
- Secret *values* that cannot federate (on-prem AD/IFD, API keys).
- The client ↔ environment mapping and the environment's **rank and gate policy** (who approves, windows, self-review).
- Per-environment values only the client knows: Dataverse connection IDs, environment-variable values, tenant variables.
- Runner placement for on-prem targets and the manual steps (PRT step registration, Deployment Administrators group).
- Contract/appetite constraints (which environments DCC may touch at all).

**The boundary, stated as a rule**: *the repo tells DCC what it builds and how; the client record tells DCC where it may
go, with which identity, and under whose approval.* Onboarding produces the **Binding** between the two and a
confirmed draft of Deployable + Process; nothing in the repo ever names a credential or a production URL.

---

## Sources (grade)
- [A] Backstage docs (GitHub mirror): system-model, descriptor-format, integrations/github/discovery, life-of-an-entity, kubernetes/configuration, permissions/overview; community-plugins tech-insights; issues #20030, #32062.
- [A] Harness developer-hub: environments/environment-overview, scope-infra-to-services, github-catalog-discovery.
- [A] Argo CD: applicationset/Generators, Generators-Cluster.
- [A] GitHub docs (mirror): deployments-and-environments, openid-connect, about-authentication-with-a-github-app; github/github-mcp-server README.
- [A] Azure DevOps docs (mirror): environments, approvals, service-endpoints, connect-to-azure, azure-devops-auditing, mcp-server/remote-mcp-server; microsoft/azure-devops-mcp README; microsoft/mcp Authentication.md.
- [A] Octopus docs (mirror): tenants index/FAQ/tags/variables/infrastructure, machine-policies, setting-up-projects, cloud-target-discovery; OptimumSetupBook MultiTenancyApps; OctopusDeploy/mcp-server README.
- [A] Power Platform docs (mirror): solution-concepts-alm, solution-layers-alm, environments-overview, manage-application-users, cli/reference auth|solution|plugin|pipeline, devops-build-tools, devops-build-tool-tasks, devops-github-actions, conn-ref-env-variables-build-tools, pipelines, guidance-deprecate-alm-accelerator; powerapps-docs register-plug-in, build-and-package, data-platform-mcp; Power Platform blog 2026-06-08 and 2026-07-06.
- [A] Dynamics 365 CE on-premises docs (mirror): register-deploy-plugins, use-connection-strings-xrm-tooling-connect.
- [A] Azure Architecture Center (mirror): multitenant considerations/identity, service/key-vault; azure-management-docs lighthouse/overview, copilot/deployment-agent; entra-docs workload-identity-federation.
- [A] HashiCorp (mirror): vault enterprise namespaces, HCP Terraform workspaces/health.
- [A] awslabs/mcp README; Google Cloud blog (managed MCP servers); containers/kubernetes-mcp-server; jenkinsci/mcp-server-plugin; blog.modelcontextprotocol.io 2026-07-28; code.claude.com best-practices and mcp; cortexapps/cli; OpsLevel terraform provider infrastructure resource; scottdurow/SparkleXrm wiki; MscrmTools/XrmToolBox.
- [A via search summary, not fetched] docs.port.io auto-discovery and data model; OpsLevel infrastructure/service-detection pages; Cortex entity relationships; GitHub MCP GA changelog; AWS MCP GA blog; ADO sprint-278 release notes; Vault/APN tenant-credential blog.
- [B] arXiv 2601.17413 (agentic PRs and CI/CD configs); Backstage catalog staleness issues.
- [C] OneUptime ADO multi-stage guide; Codefresh Argo promotion patterns; DeployRA/InfraAudit/Backstage-Ollama generators; Descope/Aembit MCP auth explainers.
