# Onboarding assistant — a Hebrew conversation about what the session is doing

Status: **done, except sending** — the assistant answers from a real session and is measured; sending an instruction into the session was not seen working end to end (see `tasks.md` 4.3).

Appetite: **medium**.

## Goal

The onboarding terminal is the real Claude Code, in English, and it does a lot
in one sitting. A person who reads English slowly needs to be able to ask, in
Hebrew, "what did it just do?", "what does it want from me?", "what happens if
I pick 2?" — and to hand it an instruction — without leaving the screen and
without disturbing the session.

## Design

- An **assistant panel under the terminal**: a Hebrew chat, a row of ready
  questions, and a free question field.
- The assistant is a **separate Claude conversation**, never the onboarding
  session. It knows the session because DCC gives it what a person would look
  at: a compact digest of the session's transcript (what was said, which tools
  ran, what is waiting), the text on the screen right now, the files changed
  so far, and read-only access to the isolated copy of the repository.
- **Economical by construction.** One long-lived conversation (`--resume`),
  so what it already read is not paid for again; each question adds only what
  is *new* since the previous one (transcript lines after a cursor, the screen
  only when it changed, the file list only when it changed). Its own small
  system prompt, no thinking, short answers, read-only tools. Its cost is its
  own line in the run's cost card, and "new conversation" drops a long context.
- **Two ways to instruct the session**, the person's choice: type in the
  terminal as today, or ask the assistant to word an instruction. The assistant
  proposes it as a card (Hebrew explanation, editable English text) and
  **nothing reaches the session until the person presses "שלח לסשן"**. It is
  sent under their name and lands on the decision log like anything they type.
  DCC sends only when the session looks idle (its last transcript entry is a
  finished answer, nothing waiting on a tool or approval); otherwise it says
  so and asks before sending anyway.
- The assistant never types into the terminal by itself and never writes
  files.

## Out of scope

Automatic sending without a click (an explicit option for later), streaming
answers, and the assistant answering in the terminal.
