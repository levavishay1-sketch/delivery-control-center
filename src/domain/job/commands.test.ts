import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { claimJobs, completeJob, computeBackoffDelayMs, enqueueJob, failJob } from "./commands";

/**
 * Integration tests against a real local Postgres. Job has no FK
 * dependencies, so each test just creates/cleans up its own job rows.
 */

const createdJobIds: string[] = [];

afterEach(async () => {
  if (createdJobIds.length > 0) {
    await db.job.deleteMany({ where: { id: { in: createdJobIds } } });
    createdJobIds.length = 0;
  }
});

function key(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("enqueueJob", () => {
  it("creates a QUEUED job with the given payload", async () => {
    const idempotencyKey = key("enqueue-basic");
    const job = await enqueueJob("DRAFT_STAGE", { stageId: "abc" }, idempotencyKey);
    createdJobIds.push(job.id);

    expect(job.status).toBe("QUEUED");
    expect(job.type).toBe("DRAFT_STAGE");
    expect(job.payload).toEqual({ stageId: "abc" });
    expect(job.attempts).toBe(0);
  });

  it("is idempotent on idempotencyKey: a second enqueue returns the existing job", async () => {
    const idempotencyKey = key("enqueue-idempotent");
    const first = await enqueueJob("DRAFT_STAGE", { stageId: "abc" }, idempotencyKey);
    createdJobIds.push(first.id);
    const second = await enqueueJob("DRAFT_STAGE", { stageId: "different" }, idempotencyKey);

    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual({ stageId: "abc" });

    const count = await db.job.count({ where: { idempotencyKey } });
    expect(count).toBe(1);
  });
});

describe("claimJobs", () => {
  it("claims due QUEUED jobs and marks them RUNNING with lockedBy set", async () => {
    const job = await enqueueJob("DRAFT_STAGE", {}, key("claim-basic"));
    createdJobIds.push(job.id);

    const claimed = await claimJobs("worker-a", 10);
    const claimedIds = claimed.map((j) => j.id);
    expect(claimedIds).toContain(job.id);

    const found = claimed.find((j) => j.id === job.id)!;
    expect(found.status).toBe("RUNNING");
    expect(found.lockedBy).toBe("worker-a");
    expect(found.lockedAt).not.toBeNull();
  });

  it("does not claim jobs scheduled in the future", async () => {
    const idempotencyKey = key("claim-future");
    const job = await db.job.create({
      data: { type: "DRAFT_STAGE", payload: {}, idempotencyKey, scheduledAt: new Date(Date.now() + 60_000) },
    });
    createdJobIds.push(job.id);

    const claimed = await claimJobs("worker-a", 50);
    expect(claimed.map((j) => j.id)).not.toContain(job.id);
  });

  it("never returns overlapping job sets across two concurrent claims", async () => {
    const jobs = await Promise.all(
      Array.from({ length: 6 }, (_, i) => enqueueJob("DRAFT_STAGE", { i }, key(`claim-race-${i}`)))
    );
    createdJobIds.push(...jobs.map((j) => j.id));

    const [batchA, batchB] = await Promise.all([claimJobs("worker-a", 3), claimJobs("worker-b", 3)]);

    const idsA = batchA.filter((j) => jobs.some((seeded) => seeded.id === j.id)).map((j) => j.id);
    const idsB = batchB.filter((j) => jobs.some((seeded) => seeded.id === j.id)).map((j) => j.id);

    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);
    expect(new Set([...idsA, ...idsB]).size).toBe(idsA.length + idsB.length);
    expect(idsA.length + idsB.length).toBe(6);
  });
});

describe("completeJob", () => {
  it("marks a job SUCCEEDED", async () => {
    const job = await enqueueJob("DRAFT_STAGE", {}, key("complete"));
    createdJobIds.push(job.id);
    await claimJobs("worker-a", 10);

    const completed = await completeJob(job.id);
    expect(completed.status).toBe("SUCCEEDED");
  });
});

describe("failJob", () => {
  it("reschedules with backoff and increments attempts while retries remain", async () => {
    const job = await db.job.create({
      data: { type: "DRAFT_STAGE", payload: {}, idempotencyKey: key("fail-retry"), maxAttempts: 3 },
    });
    createdJobIds.push(job.id);

    const before = Date.now();
    const failed = await failJob(job.id, "boom");

    expect(failed.status).toBe("QUEUED");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("boom");
    expect(failed.lockedAt).toBeNull();
    expect(failed.lockedBy).toBeNull();
    expect(failed.scheduledAt.getTime()).toBeGreaterThan(before);
  });

  it("marks the job permanently FAILED once retries are exhausted", async () => {
    const job = await db.job.create({
      data: { type: "DRAFT_STAGE", payload: {}, idempotencyKey: key("fail-exhausted"), maxAttempts: 1 },
    });
    createdJobIds.push(job.id);

    const failed = await failJob(job.id, "still broken");
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("still broken");
  });
});

describe("computeBackoffDelayMs", () => {
  it("doubles with each attempt", () => {
    const first = computeBackoffDelayMs(1);
    expect(computeBackoffDelayMs(2)).toBe(first * 2);
    expect(computeBackoffDelayMs(3)).toBe(first * 4);
  });
});
