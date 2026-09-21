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

## And when no screen is enough: reading the change itself

Walking the screens answers *what* changed. It does not answer *whether the
change is sound* — the question a person actually has in front of a pull
request they are about to merge, and the one they asked next: **"אני צריך
שיאשר לי את השינויים של ה-PR, בשביל זה הוא צריך לראות את הקבצים שחלקם גם
קבצי קוד."**

Reading code already exists in the chat, behind a declared cost the person
approves — but only from a requirement or an onboarding run, both of which
have a local copy of the repository. A pull request had neither, and said so:
*"קריאה בקוד אפשרית רק משיחה על דרישה או על הטמעת מאגר."*

So a request now has somewhere to read from. When the person approves the
cost, DCC fetches the change itself from the host into a folder — the unified
diff, and each changed file as it stands after the change — and the reading
happens there. Not from a local clone, which may not have the branch at all,
and never from the screen's facts.

Three things keep it honest:

- **The card says what will be opened.** A reading on a request declares the
  change and the host, not "the local copy of the repository", which would
  have been untrue.
- **It is capped, and says what it left out.** Twenty-five files, 400KB, a
  diff cut at 300KB — and the note travels into the answer, so an opinion
  drawn from part of a change says it was only part.
- **It is a reader, not an approval.** It says what the change does and what
  would concern it, each with the file. The decision stays the person's, and
  the review is still submitted from the request's own screen, to the host,
  in their name.

## What this does not do

It does not perform anything (actions already do that, behind an approval),
and it does not leave the subject the person is on. A question no screen and
no reading of DCC answers still ends in the honest marker.
