# web api.ts types vs @dcc/core exports

web exported types: 126; core exported types: 118; same name in both: 69; verbatim (comments/whitespace ignored): 34

| name | verbatim | structurally identical (checker) | core has Date | core location |
|---|---|---|---|---|
| Blocker | NO | NO | no | packages/core/src/pull-request-detail.ts:20 |
| RequirementCostSummary | yes | yes | no | packages/core/src/ai-assist.ts:605 |
| ClaudeCallView | yes | yes | no | packages/core/src/claude-center.ts:179 |
| CenterBar | yes | yes | no | packages/core/src/claude-center.ts:51 |
| ClaudeOverview | yes | NO | no | packages/core/src/claude-center.ts:53 |
| TopicRef | NO | NO | no | packages/core/src/chat/index.ts:37 |
| ChatMessage | yes | yes | no | packages/core/src/chat/index.ts:50 |
| ConversationView | yes | yes | no | packages/core/src/chat/index.ts:56 |
| Concept | NO | NO | no | packages/core/src/glossary/index.ts:25 |
| ScreenGlossary | NO | NO | no | packages/core/src/glossary/index.ts:44 |
| InsightCluster | yes | NO | no | packages/core/src/insights.ts:26 |
| InsightCallRow | yes | yes | no | packages/core/src/insights.ts:43 |
| UnhelpfulRow | yes | yes | no | packages/core/src/insights.ts:47 |
| InsightsView | yes | NO | no | packages/core/src/insights.ts:48 |
| PolicyChange | yes | yes | no | packages/core/src/policy-admin.ts:40 |
| PolicyView | NO | NO | no | packages/core/src/policy-admin.ts:65 |
| StartBuildResult | yes | yes | no | packages/core/src/start-build.ts:24 |
| AssessGap | NO | NO | no | packages/core/src/ai-assist.ts:908 |
| AssessResult | yes | NO | no | packages/core/src/ai-assist.ts:918 |
| BreakdownResult | NO | NO | no | packages/core/src/ai-assist.ts:1070 |
| TaskStatus | NO | NO | no | packages/core/src/task-status.ts:26 |
| TaskFlowNode | NO | NO | no | packages/core/src/flow.ts:140 |
| SpecPiece | yes | yes | no | packages/core/src/spec-map.ts:24 |
| SpecView | NO | NO | no | packages/core/src/spec-map.ts:34 |
| TaskFlowEdge | yes | yes | no | packages/core/src/flow.ts:173 |
| AdoTaskRow | NO | NO | no | packages/core/src/flow.ts:280 |
| MaterializeResult | NO | yes | no | packages/core/src/task-ado-sync.ts:29 |
| TaskBuiltOn | yes | yes | no | packages/core/src/ai-assist.ts:1380 |
| TaskDeleteNode | NO | NO | no | packages/core/src/ai-assist.ts:2369 |
| TaskDeletePrecheck | yes | NO | no | packages/core/src/ai-assist.ts:2374 |
| ImportResult | NO | yes | no | packages/core/src/import-ado.ts:45 |
| TaskDetail | NO | NO | yes | packages/core/src/tasks.ts:365 |
| TaskRunRecord | yes | yes | no | packages/core/src/ai-assist.ts:2148 |
| ImplementResult | NO | NO | no | packages/core/src/ai-assist.ts:1236 |
| LinkedTaskRow | yes | yes | no | packages/core/src/bugs.ts:14 |
| OnboardingStatus | NO | yes | no | packages/core/src/repo-onboarding/types.ts:14 |
| OnboardingStageKey | NO | yes | no | packages/core/src/repo-onboarding/types.ts:11 |
| OnboardingStageDefinition | NO | NO | no | packages/core/src/repo-onboarding/types.ts:17 |
| AutomationPreset | yes | NO | no | packages/core/src/repo-onboarding/types.ts:67 |
| AutomationPolicy | NO | NO | no | packages/core/src/repo-onboarding/types.ts:69 |
| Effort | yes | yes | no | packages/core/src/routing.ts:29 |
| ModelChoice | yes | NO | no | packages/core/src/repo-onboarding/types.ts:101 |
| ModelPolicy | NO | NO | no | packages/core/src/repo-onboarding/types.ts:103 |
| OnboardingSession | NO | NO | no | packages/core/src/repo-onboarding/types.ts:137 |
| CodeMapPlace | yes | NO | no | packages/core/src/code-map.ts:24 |
| CodeMapNodeKind | yes | NO | no | packages/core/src/code-map.ts:27 |
| CodeMapNode | NO | NO | no | packages/core/src/code-map.ts:29 |
| CodeMapLane | NO | NO | no | packages/core/src/code-map.ts:53 |
| CodeMapArrow | yes | NO | no | packages/core/src/code-map.ts:73 |
| CodeMap | yes | NO | no | packages/core/src/code-map.ts:76 |
| TaskOverlap | NO | NO | no | packages/core/src/task-merge.ts:21 |
| MergeResult | NO | yes | no | packages/core/src/task-merge.ts:78 |
| PullRequestRow | NO | NO | no | packages/core/src/pull-requests.ts:25 |
| PullRequestList | yes | NO | no | packages/core/src/pull-requests.ts:57 |
| NextStep | yes | NO | no | packages/core/src/pull-request-detail.ts:38 |
| FileGroup | NO | NO | no | packages/core/src/pull-request-detail.ts:43 |
| TimelineItem | NO | NO | no | packages/core/src/pull-request-detail.ts:45 |
| ConflictFile | yes | yes | no | packages/core/src/pull-request-detail.ts:35 |
| ConflictView | yes | NO | no | packages/core/src/pull-request-detail.ts:36 |
| PullRequestDetail | NO | NO | no | packages/core/src/pull-request-detail.ts:47 |
| ReviewDecision | yes | yes | no | packages/core/src/pull-request-review.ts:22 |
| ConflictSegment | yes | yes | no | packages/core/src/pull-request-conflict.ts:43 |
| ConflictFileContent | NO | NO | no | packages/core/src/pull-request-conflict.ts:45 |
| ConflictContent | NO | NO | no | packages/core/src/pull-request-conflict.ts:62 |
| CheckResult | yes | yes | no | packages/core/src/merge-verify.ts:32 |
| VerifyResult | NO | NO | no | packages/core/src/merge-verify.ts:33 |
| BranchHealth | NO | NO | no | packages/core/src/repo-branches.ts:20 |
| RepoBranches | yes | NO | no | packages/core/src/repo-branches.ts:37 |
| PullRequestQuick | NO | NO | no | packages/core/src/pull-request-detail.ts:239 |

## web types with no same-named core export

- ReqType
- EventRow
- GapState
- GapKind
- Gap
- TaskKind
- Task
- RequirementType
- WorkItem
- LinkedRepo
- Attachment
- WorkItemDetail
- Initiative
- Dashboard
- AuditPage
- FlowData
- WorkListRow
- ClientRow
- Requirement
- ClientDetail
- CenterQuery
- ChatContext
- ChatOpen
- ChatAnswer
- ProposalPayload
- DeclaredCostPayload
- PolicyCapability
- PolicyPrice
- PolicyDoc
- AdoSyncResult
- TaskFlowStep
- SpecDocLine
- SpecDocCell
- SpecDocBlock
- RequirementRung
- TaskFlow
- AdoTasks
- AllAdoTasks
- PromptTemplate
- FlowRun
- DeleteTaskConfirm
- StageAutomation
- SessionState
- ChangedFile
- ExistingSetup
- PrepareResult
- InitResult
- ReviewResult
- DeliverResult
- OnboardingRun
- OnboardingStage
- OnboardingEvent
- OnboardingCost
- PrBlocker
- PullRequestFile
- OnboardingRunView
- OnboardingRunSummary
