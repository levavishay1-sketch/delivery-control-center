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

## 7. The web reads the registry once

`GET /claude/glossary` returns every concept; `Info` fetches it once per page
load and looks the key up locally, so a screen with thirty hints makes one
request, and a hint never waits on its own round trip.

## 8. Restarts

The API is started without a file watcher, so saving a file never restarts it.
It is restarted deliberately, once at the end of each stage, and checked
(`/health`, a real screen) before the stage is called finished.
