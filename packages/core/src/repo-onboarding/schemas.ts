/**
 * JSON Schemas (draft-07 subset) for every structured result the
 * onboarding pipeline asks Claude for. Passed as `--json-schema` so the
 * CLI validates and re-prompts on mismatch; the same schema is stated in
 * the prompt as a fallback contract where the flag can't be used.
 * Deliberately shallow with few required fields — the docs' own advice:
 * "deeply nested schemas with many required fields are harder to satisfy".
 */

const str = { type: "string" } as const;
const bool = { type: "boolean" } as const;
const strArr = { type: "array", items: str } as const;

export const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    repository_type: str,
    architecture_shape: str,
    legacy_indicator: bool,
    detected_technology_stack: strArr,
    detected_domains: strArr,
    complexity: { type: "string", enum: ["low", "medium", "high"] },
    documentation_maturity: { type: "string", enum: ["none", "low", "medium", "high"] },
    testing_maturity: { type: "string", enum: ["none", "low", "medium", "high"] },
    discovery_areas_required: strArr,
    discovery_areas_not_required: strArr,
    uncertainties: strArr,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary_he: str,
  },
  required: ["repository_type", "complexity", "detected_technology_stack", "confidence", "summary_he"],
} as const;

const pathed = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: { name: str, purpose: str, paths: strArr, evidence: strArr, ...extra },
  required: ["name", "paths"],
});

export const DISCOVERY_SCHEMA = {
  type: "object",
  properties: {
    purpose: str,
    coverage: {
      type: "array",
      items: {
        type: "object",
        properties: { area: str, status: { type: "string", enum: ["COVERED", "PARTIAL", "MISSING"] }, sources: strArr, note: str },
        required: ["area", "status"],
      },
    },
    components: { type: "array", items: pathed() },
    entry_points: { type: "array", items: { type: "object", properties: { name: str, path: str, how_to_run: str }, required: ["path"] } },
    boundaries: { type: "array", items: { type: "object", properties: { description: str, paths: strArr }, required: ["description"] } },
    key_flows: { type: "array", items: { type: "object", properties: { name: str, steps: strArr, paths: strArr }, required: ["name"] } },
    integrations: { type: "array", items: { type: "object", properties: { system: str, direction: { type: "string", enum: ["inbound", "outbound", "both", "unknown"] }, paths: strArr, constraints: strArr }, required: ["system"] } },
    generated_or_protected_areas: { type: "array", items: { type: "object", properties: { path: str, reason: str, kind: { type: "string", enum: ["generated", "vendored", "infrastructure", "sensitive", "other"] } }, required: ["path", "reason"] } },
    build_test: {
      type: "array",
      items: { type: "object", properties: { name: str, command: str, cwd: str, evidence: str, confidence: { type: "string", enum: ["low", "medium", "high"] } }, required: ["name", "command", "confidence"] },
    },
    constraints: { type: "array", items: { type: "object", properties: { statement: str, evidence: str, severity: { type: "string", enum: ["low", "medium", "high"] } }, required: ["statement"] } },
    where_to_look: { type: "array", items: { type: "object", properties: { task_type: str, paths: strArr, note: str }, required: ["task_type", "paths"] } },
    existing_instructions_assessment: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: str,
          /** Is the CONTENT still true. */
          verdict: { type: "string", enum: ["keep", "merge", "outdated", "conflicting"] },
          reason: str,
          /** Is the FORM still right — asked on the same read, since the
           *  file is already open to judge `verdict`. */
          reshape: { type: "string", enum: ["none", "supersede_with_skill", "consolidate", "redundant"] },
          reshape_note_he: str,
          /** The artifact that would take this file's job over. */
          reshape_target: str,
        },
        required: ["path", "verdict"],
      },
    },
    /** One paragraph on the repository's existing AI setup as a whole —
     *  what is there, how much of it still holds, what shape it is in.
     *  The plan stage leads its own rationale with this. */
    existing_setup_summary_he: str,
    unknowns: strArr,
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { id: str, question_he: str, why_it_matters_he: str, risk_if_unknown: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, related_area: str },
        required: ["id", "question_he", "why_it_matters_he", "risk_if_unknown"],
      },
    },
    evidence_paths: strArr,
  },
  required: ["purpose", "coverage", "components", "questions", "unknowns"],
} as const;

const PLANNED_ITEM = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["claude_md", "nested_claude_md", "rule", "knowledge_skill", "workflow_skill", "agent", "legacy_artifact"] },
    path: str,
    /** `remove` is only ever valid on `legacy_artifact` — no other kind
     *  may propose deleting a file. */
    action: { type: "string", enum: ["create", "update", "skip", "remove"] },
    /** `legacy_artifact` only: the `key`/name of the item taking over. */
    superseded_by: str,
    title_he: str,
    justification: str,
    consumers: { type: "array", items: { type: "string", enum: ["requirement", "understanding", "planning", "implementation", "testing", "review", "deployment", "future_sessions"] } },
    watched_paths: strArr,
    source_of_truth: str,
    skill_name: str,
    skill_description: str,
    skill_paths: strArr,
    disable_model_invocation: bool,
    rule_paths: strArr,
    estimated_lines: { type: "integer" },
  },
  required: ["kind", "path", "action", "justification"],
} as const;

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    artifacts: { type: "array", items: PLANNED_ITEM },
    not_created: { type: "array", items: { type: "object", properties: { kind: str, reason_he: str }, required: ["kind", "reason_he"] } },
    rationale_he: str,
  },
  required: ["artifacts", "not_created"],
} as const;

export const GENERATE_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: { type: "object", properties: { key: str, path: str, content: str, notes_he: str }, required: ["key", "path", "content"] },
    },
    summary_he: str,
    skipped: { type: "array", items: { type: "object", properties: { key: str, reason_he: str }, required: ["key", "reason_he"] } },
    // The guardrail hooks' protected-path list is a deterministic
    // artifact (`writer: "dcc"`) — the model never drafts its content,
    // so without an explicit correction channel a validate finding
    // about it ("blocks a hand-written path", "protects nothing") can
    // never be fixed by the one automatic retry: the same list would be
    // re-rendered unchanged on every attempt. This field is that
    // channel. Omit it when the current list needs no change.
    protected_globs_correction: { type: "array", items: str },
  },
  required: ["files"],
} as const;

export const VALIDATE_SCHEMA = {
  type: "object",
  properties: {
    overall_status: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          artifact: str, problem_he: str, evidence: str, recommended_correction_he: str,
          category: { type: "string", enum: ["contradiction", "unsupported_claim", "duplication", "generic_filler", "missing_critical", "broken_reference", "ineffective_guardrail", "other"] },
        },
        required: ["severity", "artifact", "problem_he"],
      },
    },
    strengths_he: strArr,
  },
  required: ["overall_status", "issues"],
} as const;

export const REFRESH_SCHEMA = {
  type: "object",
  properties: {
    update_required: bool,
    impacted_artifacts: strArr,
    required_updates_he: strArr,
    evidence: strArr,
    reason_he: str,
  },
  required: ["update_required", "reason_he"],
} as const;
