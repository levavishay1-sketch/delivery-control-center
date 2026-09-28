import type { ReactNode } from "react";

/**
 * A run of Latin letters or digits inside Hebrew text: `AI`, `TFS`, `Claude Code`,
 * `Azure DevOps`, `30%`, `/init`, `ai/onboarding/<id>`. Spaces join two words of one
 * run; punctuation next to it does not belong to it.
 */
const LATIN_RUN = /[A-Za-z0-9](?:[A-Za-z0-9._\-/+#@]|\s(?=[A-Za-z0-9]))*/g;

/**
 * Hebrew text that contains English, rendered so it reads the same wherever it
 * starts. The bidi algorithm places a neutral character (`;` `=` `·` `(`) by
 * looking at the letters on both sides of it, so `... יותר AI; המספר ...` comes out
 * scrambled — and differently depending on whether the sentence happens to begin in
 * Hebrew or English. Wrapping each English run in `<bdi dir="ltr">` isolates it: the
 * run keeps its own order, and everything around it is laid out as plain right-to-left
 * text. Use it for any explanation or message that mixes the two languages.
 */
export function BidiText({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<bdi key={at} dir="ltr">{m[0]}</bdi>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
