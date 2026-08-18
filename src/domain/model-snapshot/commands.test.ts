import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureModelSnapshotJobScheduled, nextSunday07UTC, recordModelSnapshotAttempt, scheduleNextModelSnapshotFetch } from "./commands";

/** Integration tests against a real local Postgres, same rationale as job/commands.test.ts. */

const createdJobIds: string[] = [];
const createdSnapshotIds: string[] = [];

afterEach(async () => {
  if (createdJobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: createdJobIds } } });
    createdJobIds.length = 0;
  }
  if (createdSnapshotIds.length > 0) {
    await db.modelSnapshot.deleteMany({ where: { id: { in: createdSnapshotIds } } });
    createdSnapshotIds.length = 0;
  }
  // Tests below create real FETCH_MODEL_SNAPSHOT rows outside the createdJobIds tracking (via
  // ensureModelSnapshotJobScheduled/scheduleNextModelSnapshotFetch) — sweep any leftovers so one
  // test's schedule doesn't make the next test's "no pending job" assumption false.
  await db.job.deleteMany({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
});

describe("nextSunday07UTC", () => {
  it("returns the same day's 07:00 when `from` is a Sunday before 07:00", () => {
    const from = new Date("2026-08-16T06:00:00Z");
    expect(nextSunday07UTC(from).toISOString()).toBe("2026-08-16T07:00:00.000Z");
  });

  it("returns the following Sunday's 07:00 when `from` is a Sunday after 07:00", () => {
    const from = new Date("2026-08-16T08:00:00Z");
    expect(nextSunday07UTC(from).toISOString()).toBe("2026-08-23T07:00:00.000Z");
  });

  it("returns the upcoming Sunday's 07:00 for a mid-week date", () => {
    const from = new Date("2026-08-17T12:00:00Z"); // a Monday
    expect(nextSunday07UTC(from).toISOString()).toBe("2026-08-23T07:00:00.000Z");
  });
});

describe("scheduleNextModelSnapshotFetch", () => {
  it("enqueues a FETCH_MODEL_SNAPSHOT job scheduled for next Sunday 07:00", async () => {
    const from = new Date("2026-08-17T12:00:00Z");
    await scheduleNextModelSnapshotFetch(from);

    const job = await db.job.findFirstOrThrow({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    createdJobIds.push(job.id);
    expect(job.status).toBe("QUEUED");
    expect(job.scheduledAt.toISOString()).toBe("2026-08-23T07:00:00.000Z");
  });

  it("is idempotent for the same target week (does not create a second job)", async () => {
    const from = new Date("2026-08-17T12:00:00Z");
    await scheduleNextModelSnapshotFetch(from);
    await scheduleNextModelSnapshotFetch(new Date("2026-08-18T00:00:00Z")); // same target week

    const jobs = await db.job.findMany({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    createdJobIds.push(...jobs.map((j) => j.id));
    expect(jobs).toHaveLength(1);
  });
});

describe("ensureModelSnapshotJobScheduled", () => {
  it("schedules a job when none is pending", async () => {
    await ensureModelSnapshotJobScheduled();
    const jobs = await db.job.findMany({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    createdJobIds.push(...jobs.map((j) => j.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("QUEUED");
  });

  it("is a no-op when a job is already QUEUED", async () => {
    await ensureModelSnapshotJobScheduled();
    const first = await db.job.findFirstOrThrow({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    createdJobIds.push(first.id);

    await ensureModelSnapshotJobScheduled();
    const jobs = await db.job.findMany({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(first.id);
  });

  it("is a no-op when a job is already RUNNING", async () => {
    await ensureModelSnapshotJobScheduled();
    const pending = await db.job.findFirstOrThrow({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    createdJobIds.push(pending.id);
    await db.job.update({ where: { id: pending.id }, data: { status: "RUNNING" } });

    await ensureModelSnapshotJobScheduled();
    const jobs = await db.job.findMany({ where: { type: "FETCH_MODEL_SNAPSHOT" } });
    expect(jobs).toHaveLength(1);
  });
});

describe("recordModelSnapshotAttempt", () => {
  it("records a SUCCESS attempt with its extracted models", async () => {
    const snapshot = await recordModelSnapshotAttempt({
      status: "SUCCESS",
      rawContent: "raw page text",
      extractedModels: [{ modelId: "claude-opus-4-5", pricingText: "$15 per million tokens" }],
    });
    createdSnapshotIds.push(snapshot.id);

    expect(snapshot.status).toBe("SUCCESS");
    expect(snapshot.rawContent).toBe("raw page text");
    expect(snapshot.extractedModels).toEqual([{ modelId: "claude-opus-4-5", pricingText: "$15 per million tokens" }]);
    expect(snapshot.failureReason).toBeNull();
  });

  it("records a FAILED attempt with its failure reason and no fabricated models", async () => {
    const snapshot = await recordModelSnapshotAttempt({
      status: "FAILED",
      rawContent: "unrecognizable page content",
      failureReason: "No recognizable model/pricing/context-window facts found on the source page.",
    });
    createdSnapshotIds.push(snapshot.id);

    expect(snapshot.status).toBe("FAILED");
    expect(snapshot.extractedModels).toEqual([]);
    expect(snapshot.failureReason).toContain("No recognizable");
  });
});
