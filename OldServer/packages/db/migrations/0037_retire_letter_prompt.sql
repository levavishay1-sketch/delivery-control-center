-- Claude in DCC, stage 5 (openspec/changes/claude-in-dcc): the message to
-- the requester is an answer of the one chat now, written from the open
-- gaps the screen hands over. The prompt template that composed it has no
-- caller left — a template nothing renders is a statement, not a prompt.
DELETE FROM "prompt_template" WHERE "key" = 'gaps.client_letter';
