/**
 * The onboarding pipeline's own methodology version (spec §27: "Did the
 * repository use onboarding v2 or v4?") — distinct from a per-prompt
 * `onboarding_prompt_template.version`, which already answers "which
 * exact text ran." Bump this when the STAGE_ORDER/pipeline shape itself
 * changes in a way worth distinguishing later, not on every prompt edit.
 */
export const ONBOARDING_METHODOLOGY_VERSION = "1";
