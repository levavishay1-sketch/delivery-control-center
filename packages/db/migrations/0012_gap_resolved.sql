-- 0012 — a Gap can be answered without being dismissed. "resolved"
-- means a real gap that now has a recorded decision, so it no longer
-- blocks. "dismissed" stays "was never a real gap".
ALTER TYPE "gap_state" ADD VALUE IF NOT EXISTS 'resolved';
