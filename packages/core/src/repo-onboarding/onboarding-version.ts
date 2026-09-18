/**
 * The onboarding pipeline's methodology version — stamped into every
 * generated artifact and recorded on the run, so a later refresh can
 * tell which shape of pipeline produced what's in the repository.
 * Distinct from a per-prompt `onboarding_prompt_template.version`
 * ("which exact text ran"). Bump when the stage set or the artifact
 * model changes, not on a prompt edit.
 */
export const ONBOARDING_METHODOLOGY_VERSION = "v2";
