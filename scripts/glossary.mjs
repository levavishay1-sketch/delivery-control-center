// The "i" registry, read by the repo's scripts (audit-stale, info-drift).
// The entries live in Server/glossary: one JSON file per area under
// concepts/, and screens.json (what each chat-registered screen is for).
// The server reads the same files (Dcc.Infrastructure/Glossary).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const REGISTRY_DIR = "Server/glossary";
const CONCEPTS_DIR = `${REGISTRY_DIR}/concepts`;

let cache = null;
function load() {
  if (cache) return cache;
  const concepts = readdirSync(CONCEPTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(path.join(CONCEPTS_DIR, f), "utf8")));
  const screens = JSON.parse(readFileSync(`${REGISTRY_DIR}/screens.json`, "utf8"));
  cache = { concepts, byKey: new Map(concepts.map((c) => [c.key, c])), screens };
  return cache;
}

export const allConcepts = () => load().concepts;
export const getConcept = (key) => load().byKey.get(key) ?? null;
export const glossaryScreens = () => Object.keys(load().screens);
