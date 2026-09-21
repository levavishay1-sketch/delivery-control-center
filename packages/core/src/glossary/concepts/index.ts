import type { Concept } from "../index.ts";
import { CLAUDE_CONCEPTS } from "./claude.ts";
import { ONBOARDING_CONCEPTS } from "./onboarding.ts";
import { OVERVIEW_CONCEPTS } from "./overview.ts";
import { PAGE_CONCEPTS } from "./pages.ts";
import { PULL_REQUEST_CONCEPTS } from "./pull-request.ts";
import { REQUIREMENT_CONCEPTS } from "./requirement.ts";
import { TASK_CONCEPTS } from "./task.ts";

/**
 * Every concept, one array per area. Nothing outside `glossary/` reads this
 * directly — see `getConcept` / `allConcepts` in `../index.ts`. A new area is
 * a new file here plus one line below.
 */
export const CONCEPTS: Concept[] = [
  ...PAGE_CONCEPTS,
  ...REQUIREMENT_CONCEPTS,
  ...TASK_CONCEPTS,
  ...PULL_REQUEST_CONCEPTS,
  ...ONBOARDING_CONCEPTS,
  ...CLAUDE_CONCEPTS,
  ...OVERVIEW_CONCEPTS,
];
