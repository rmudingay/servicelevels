import assert from "node:assert/strict";
import test from "node:test";
import type { Snapshot } from "@service-levels/shared";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";

function buildSnapshot(id: string, collectedAt: string, overallStatus: Snapshot["overallStatus"]): Snapshot {
  return {
    id,
    tenantId: "tenant-primary-site",
    collectedAt,
    overallStatus,
    services: [
      {
        serviceId: "svc-prom",
        status: overallStatus,
        summary: `Status is ${overallStatus}`,
        lastCheckedAt: collectedAt
      }
    ],
    rawPayload: { source: "test" }
  };
}

test("saveSnapshot stores the latest snapshot and daily rollups", async () => {
  const store = new MemoryStore(loadConfig({}));

  const first = buildSnapshot("snapshot-1", "2026-04-18T23:50:00.000Z", "healthy");
  const second = buildSnapshot("snapshot-2", "2026-04-19T00:10:00.000Z", "down");

  await store.saveSnapshot(first);
  await store.saveSnapshot(second);

  const latest = await store.getLatestSnapshot("tenant-primary-site");
  const serviceEvents = await store.getServiceStatusEvents("tenant-primary-site");
  const summaries = await store.getDailySummaries("tenant-primary-site");

  assert.equal(latest?.id, "snapshot-2");
  assert.equal(serviceEvents.some((entry) => entry.snapshotId === "snapshot-2" && entry.serviceId === "svc-prom"), true);
  assert.equal(summaries.length >= 2, true);

  const yesterday = summaries.find((entry) => entry.day === "2026-04-18");
  const today = summaries.find((entry) => entry.day === "2026-04-19");

  assert.ok(yesterday);
  assert.ok(today);
  assert.equal(yesterday?.overallStatus, "healthy");
  assert.equal(today?.overallStatus, "down");
  assert.equal(yesterday?.secondsByStatus.healthy, 600);
  assert.equal(today?.secondsByStatus.healthy, 600);
  assert.equal(yesterday?.sampleCount, 1);
  assert.equal(today?.sampleCount, 1);
});
