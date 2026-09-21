# The chat walks to the screen that holds the answer

Status: **applied** — see `tasks.md`.

Appetite: **small**.

## The problem, in the person's words

A person stood on the overview of a pull request and asked "which files
changed?". The chat answered: *"אין לו את זה במסך"* — it does not have it on
the screen — and then explained, correctly, that the answer lives on another
tab and that someone should press it. The person's reply was the whole
proposal: **"יש לך את המסך של הקבצים בו תוכל לראות את כל השינויים"** — you
have the files screen, you can see all the changes there.

They were right, and the chat was not wrong about the facts: it answers only
from what the open screen registered, and the overview registers the header,
the blockers and the next step. It had no way to go and look, and no way to
know that a place to look existed.

## What changes

The chat gets a map of DCC and permission to walk it. When the answer is not
on the screen the person is on, but is on another screen of the same subject,
the chat takes them there and answers from what is there — instead of naming
a tab and stopping.

From the person's side it is one question and one answer. The screen moves
under the chat, which says where it went and why, and the answer that follows
is drawn from the facts of the place it arrived at.

## What holds it honest

Four rules, each enforced in code rather than asked of the model:

- **It may only go where a registry says it may.** `packages/core/src/screens`
  lists every place: its name, what it answers that the others do not, and how
  to build its route from the subject in hand. A key the model invents moves
  nobody and is counted as a question left unanswered.
- **A place must be a screen that hands over its facts.** The chat moves in
  order to answer, so a screen it would land on with nothing to read is not a
  destination. Each tab of a pull request now hands over what it shows.
- **It moves inside its own subject.** The subject decides the conversation, so
  a move keeps the person in the conversation they were in. A place belonging
  to another subject is never offered.
- **One move per question.** After a move the places are withheld, so the chat
  answers from where it stands or says plainly that it cannot — it can never
  walk in circles at the person's expense.

## What it costs

A question the chat can answer where it stands costs what it did before, and
a question it answers from the glossary or the facts still costs nothing. A
question that needs a move costs two calls instead of one — measured here at
about half a cent for the move and the same again for the answer, on the model
the policy routes chat to. The move itself is recorded in the conversation, so
the second call is visible for what it is rather than looking like a re-ask.

## What this does not do

It does not read code (`<needs_code>` already does that, behind an approval),
it does not perform anything (actions already do that, behind an approval),
and it does not leave the subject the person is on. A question no screen of
DCC answers still ends in the honest marker.
