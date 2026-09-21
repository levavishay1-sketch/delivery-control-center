# Info hints — design

Decisions taken while writing this change, with the reason for each, so they
are not reopened by accident.

## 1. Keyed by concept

A person meets the same idea on several screens — the money the AI spent, a
review, a branch. If each screen owned its wording the sentences would drift
apart, and a correction would have to be made in three places. So an entry's
key names the **concept** (`ai_cost`, `pr_review`, `branch_project`); a screen
is only a list of the concepts it shows. When two things merely share a word
(the "review" of a pull request and the "review" step of onboarding) they are
two concepts with two keys.

## 2. One access surface, flat entries

```ts
type Concept = {
  key: string;            // unique, snake_case, by concept
  kind: "button" | "term" | "field" | "section";
  title: string;          // the name as it appears on screen
  aliases?: string[];     // other ways a person says it (the chat matches on these)
  explain: string;        // what it is — one or two plain sentences
  press?: string;         // buttons only: what happens, and what does not
};
```

Everything — the chat, the insights, the API, the audit — reads through
`getConcept` / `allConcepts` / `glossaryFor`. Moving the data to a table later
replaces the body of those functions and nothing else; the entries carry no
JSX, no function, no reference to another entry.

## 3. Where the data lives now

In code, split by area (`concepts/<area>.ts`), one array per file. It is
reviewed with the change that needs it and checked by the audit. The cost is
that editing a sentence needs a release; the wishlist item "move the glossary
to the database" is where that is bought back.

## 4. What gets an "i"

| Element | "i"? |
|---|---|
| Page title (`PageHead`) | yes — what the screen is for |
| Card / section title (`CardTitle`) | yes |
| A figure or tile (`StatTile`, a labelled number) | yes |
| A field whose meaning is not obvious from its label | yes |
| A button | only if irreversible, costly, external, or not what its name says |
| A tab, a plain link, a table column that says what it is | no |

`info={null}` is the explicit way to say "this heading needs none" — allowed,
visible in review, and counted by the audit report.

## 5. Wording

Hebrew. One or two short sentences; the audit fails an `explain` above a
length limit. Write for someone who learned what a branch or a merge is only
recently: say what the thing **is**, and for a button what **happens** and what
does **not**. No English term is left without its meaning beside it. Numbers
and states are described, never quoted from an example.

## 6. Enforcement is structural first

The "i" is a prop of the shared components, so the natural way to build a
heading already asks for it. The audit is the backstop for the rest: raw
`h1`–`h4` in a screen, an unknown key, a registered chat screen with no
glossary, a duplicate key or title.

Two questions decide whether the rule survives the people who wrote it:
**will a new element get an "i"**, and **will an old one stay true**. They
have different answers.

### A new element — four layers, strongest first

1. **The type system.** `info` is required on `PageHead`, `CardTitle` and
   `StatTile`, so a new card or page title does not compile without one.
2. **`npm run audit:stale`.** Fails a heading written by hand, and a label, a
   table column or a figure that names something and opens no explanation.
   The rule of what "names something" means lives in `scripts/info-lint.mjs`
   and nowhere else, so the audit and the hook cannot drift apart.
3. **A hook** (`hooks/info-hint-check.mjs`, PostToolUse on Edit / Write) that
   says the same thing the moment a screen file is saved — the fix then costs
   one line instead of a second pass over ten screens. It never blocks.
4. **The skill and `CLAUDE.md`** — last, because they need someone to read them.

The heuristic is deliberately narrow. The classes `l` and `tt` carry free text
as often as they carry a name, so linting them would cry wolf and the check
would stop being read. An element that genuinely needs no explanation opts out
with `{/* no-info: why */}` above it: visible in review, and counted by the
audit so an opt-out cannot quietly become the norm.

## 7. An explanation that stopped being true

The harder half. The wording lives in `packages/core/src/glossary/`, the thing
it describes lives in a screen, and nothing connects them — so a button that
starts writing to TFS keeps an "i" that says it does not. A stale explanation
is worse than a missing one, because it is believed.

**What was rejected.** Fingerprinting the code a concept describes — a hash of
the JSX block and its handler, with the audit failing when the hash moves. It
is precise and it is brittle: a reformat trips it, it needs a "re-bless" step,
and a check people re-bless without reading is worse than no check.

**What was built** (`npm run info:drift`). The diff, at `-U0`, gives the exact
lines a change touched. An "i" within three lines of one of them is a suspect.
The command prints those explanations with their current wording and asks the
one question a machine cannot answer: *did the meaning change?* It is a prompt
and not a gate — most edits do not change meaning, and a gate that fires on
every screen edit would be clicked past. It is wired where it will actually be
read: `CLAUDE.md` says to run it before a pull request that touches a screen,
the `info-hints` skill says the same, and the `reviewer` subagent treats a
stale explanation as a blocking finding.

**The slow signal.** A hint can be accurate and still unclear, and no check
catches that — only a person asking again. The control center already clusters
repeated questions per screen; a cluster now also names the **concept** the
question is about, derived at read time with the same matcher the chat uses
(`matchGlossary`, so it is never stored and never goes stale). A question that
keeps coming back about an element that already has an "i" is a different
finding from a missing fact: it says the explanation is the suspect. The
screen says so in those words.

## 8. The web reads the registry once

`GET /claude/glossary` returns every concept; `Info` fetches it once per page
load and looks the key up locally, so a screen with thirty hints makes one
request, and a hint never waits on its own round trip.

## 9. Reading and placement

Two things that only show on a real screen, both found by the user looking at it.

**Hebrew with English inside.** A sentence like "…לקוח שצורך יותר AI; המספר…" is laid out by the bidi algorithm, which places a neutral character (`;` `=` `·`) by the letters on either side of it — so the same sentence came out scrambled, and differently depending on whether it began in Hebrew or English. The rule is that an explanation is **always** right-to-left, right-aligned, whatever its first letter. `BidiText` (`claude/BidiText.tsx`) wraps every run of Latin letters or digits in `<bdi dir="ltr">`, so the run keeps its own order and everything around it is plain right-to-left text; the bubble itself carries `dir="rtl"`. The chat answers with the same words and uses the same component. Wording never has to be written around the problem.

**A bubble that hides behind the next card.** Drawn inside the card that holds the "i", the bubble lives in that card's stacking context: the next card paints over it and any `overflow` clips it. It is now drawn in a portal on `<body>` with fixed coordinates and a z-index above every card, the sidebar and the chat dock. It opens under the "i" (above it when there is no room), stays inside the window, and follows the "i" while any container scrolls. Because a portal still bubbles events through the React tree, a click inside the bubble stops there and does not reach the card.

## 10. Restarts

The API is started without a file watcher, so saving a file never restarts it.
It is restarted deliberately, once at the end of each stage, and checked
(`/health`, a real screen) before the stage is called finished.
