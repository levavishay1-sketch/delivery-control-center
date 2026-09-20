# Delivery Control Center — Gaps & Readiness Session

**Date**: 2026-09-12  
**Status**: Implementation Complete, Open Question on Investigation Feature  
**Commit**: `90681b4` — The gaps stage becomes the real gate

## Summary

A full redesign of how gaps (open questions) are managed during requirement readiness assessment. Gaps transform from simple observations into structured questions with metadata, decision rights, and business context.

## Core Design Decisions

### 1. ALL gaps block breakdown (not just blocking gaps)
- Previously: only `blocking: true` gaps would block the flow
- Now: any open gap of any kind must be resolved before breakdown starts
- Rationale: An open question decided later means re-doing task trees built on wrong assumptions
- Blocking flag remains as urgency indicator

### 2. Dismissing a gap requires a reason
- When marking a gap "not a real gap" (נדחה כלא-פער), user must provide explanation
- Reason is recorded as a note in the requirement's audit trail
- This prevents the same question being raised again on next assess run
- It teaches future Claude runs what to skip

### 3. Output format is authored once, not five times
- Removed individual output contracts from each of 5 readiness tiers (quick/standard/thorough/audit/custom)
- Created single shared template: `assess.shared.output_contract`
- Applied at runtime to whichever tier runs
- Demands: short bullets (not paragraphs), one idea per line, no code identifiers mid-sentence, every gap phrased as question
- Fix readability once → fixes all five tiers

### 4. Gaps are structured questions, not observations
Each gap now carries:
- `description`: the question itself, phrased so a person can answer it
- `why`: one short line explaining why this matters
- `kind`: business | technical | missing_info | new_scope
- `whoAnswers`: "client" (only requester can decide) vs "team" (we decide)
- `options`: up to 3 candidate answers (clickable instead of typing)
- `impactIfWrong`: what breaks if we guess wrong
- `blocking`: urgency flag

### 5. Cheap client-facing letters
- A prompt template on the cheap model turned the open gaps into a business-Hebrew message
- No code, no jargon, numbered questions with lettered option buttons
- User copies and sends themselves (no automatic client channel)
- Since `claude-in-dcc` the message is an answer of the one chat (a chip on the requirement's conversation); the template, the endpoint and the composer are gone

## Implementation Files

**Database**
- `packages/db/migrations/0021_assess_prompt_tiers.sql` — Split assess into 5 tiers, added shared output contract
- `packages/db/migrations/0022_gaps_stage.sql` — Extended gap table with why/kind/whoAnswers/options/impactIfWrong

**Backend**
- `packages/core/src/gaps.ts` — proposeGap(), verifyGap() (records dismissal reasons as notes)
- `packages/core/src/ai-assist.ts` — buildAssessPrompt() appends contract template; a letter composer (since moved into the chat)
- `apps/api/src/server.ts` — a letter endpoint (since removed); updated /assess to accept {promptKey, customEmphasis, model}

**Frontend**
- `apps/web/src/screens/Record.tsx` — Gap cards enriched with whoAnswers pill, why box, impactIfWrong, option buttons; "✉ נסח פערים ללקוח" opens letter modal
- `apps/web/src/screens/WorkflowTab.tsx` — Gate changed from `openBlockingGaps === 0` to `openGaps === 0`; after assess, rail unpins so flow lands on gaps (or breakdown if none)

## Verified End-to-End

Tested on deliberately ambiguous requirement:  
*"כאשר לקוח נמצא בבקרת הלבנת הון ומאשרים אותו, צריך לשלוח לו הודעת SMS. לא ברור מה קורה אם אין לו טלפון במערכת."*

Result: 4 gaps returned, all correctly marked as client decisions (whoAnswers: "client"), first option lifted from existing code pattern, generated business letter clean Hebrew with no jargon.

## Open Question: Gap Investigation Feature

**The Question**: Should we add a "🔍 חקור את הפער" (Investigate gap) button?

**The Concern** (from user): If a gap was proposed during assess, Claude already investigated it. Re-investigating the same question is redundant.

**Possible Purposes**:
1. **Evidence gathering**: Show where in code this is relevant — but Claude did this during assess
2. **User skepticism resolution**: User reads gap, thinks "is this real?", clicks to see evidence more clearly
3. **Narrow re-assessment**: Deep dive on ONE gap (as opposed to assessing the entire requirement)
4. **Decision support**: Not just options, but a recommendation based on code analysis

**Decision Pending**: What makes a gap "needing investigation"? Is it:
- A gap the user doesn't understand?
- A gap where the code has changed since assess?
- A gap where Claude should form a recommendation, not just list options?

---

## Next Steps

1. Clarify the investigation feature scope
2. Delete test requirement from pilot (SMS/phone number question)
3. Prepare for full user testing with Altshuler Trade pilot client
