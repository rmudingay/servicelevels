import assert from "node:assert/strict";
import test from "node:test";
import { buildStatusFeed, processStatusEvents, setNotificationTestOverrides } from "../src/notifications.js";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";

test("buildStatusFeed includes the latest snapshot, open incidents, maintenance, and active banners", async () => {
  const config = loadConfig({
    APP_BASE_URL: "https://status.example.org"
  });
  const store = new MemoryStore(config);

  const xml = await buildStatusFeed(config, store, "primary-site");

  assert.match(xml, /<title>Service Levels application - Primary Site<\/title>/);
  assert.match(xml, /Current status:/);
  assert.match(xml, /Incident:/);
  assert.match(xml, /Maintenance:/);
  assert.match(xml, /Banner:/);
  assert.match(xml, /https:\/\/status\.example\.org\//);
});

test("processStatusEvents opens and resolves maintenance windows from collected state", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  const previous = await store.getLatestSnapshot(tenant.id);
  assert.ok(previous);

  const maintenanceSnapshot = {
    ...previous,
    id: "snapshot-maintenance",
    collectedAt: "2026-04-20T12:00:00.000Z",
    overallStatus: "maintenance" as const,
    services: previous.services.map((service) =>
      service.serviceId === "svc-auth"
        ? {
            ...service,
            status: "maintenance" as const,
            summary: "Authentication maintenance",
            lastCheckedAt: "2026-04-20T12:00:00.000Z"
          }
        : service
    )
  };

  await processStatusEvents(config, store, tenant, previous, maintenanceSnapshot);
  const activeMaintenance = (await store.getMaintenanceWindows(tenant.id)).find((entry) => entry.serviceId === "svc-auth" && entry.status === "active");
  assert.ok(activeMaintenance);

  const resolvedSnapshot = {
    ...maintenanceSnapshot,
    id: "snapshot-maintenance-resolved",
    collectedAt: "2026-04-20T12:10:00.000Z",
    overallStatus: "healthy" as const,
    services: maintenanceSnapshot.services.map((service) =>
      service.serviceId === "svc-auth"
        ? {
            ...service,
            status: "healthy" as const,
            summary: "Authentication recovered",
            lastCheckedAt: "2026-04-20T12:10:00.000Z"
          }
        : service
    )
  };

  await processStatusEvents(config, store, tenant, maintenanceSnapshot, resolvedSnapshot);
  const resolvedMaintenance = (await store.getMaintenanceWindows(tenant.id)).find((entry) => entry.id === activeMaintenance.id);
  assert.equal(resolvedMaintenance?.status, "resolved");
});

test("processStatusEvents becomes a no-op when there are no state transitions", async () => {
  const config = loadConfig({
    SLACK_WEBHOOK_URL: "https://hooks.slack.example/global"
  });
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  const previous = await store.getLatestSnapshot(tenant.id);
  assert.ok(previous);
  const slackCalls: string[] = [];

  setNotificationTestOverrides({
    async deliverSlack(webhookUrl) {
      slackCalls.push(webhookUrl);
    }
  });

  try {
    await processStatusEvents(config, store, tenant, previous, {
      ...previous,
      id: "snapshot-same",
      collectedAt: "2026-04-20T12:15:00.000Z"
    });
  } finally {
    setNotificationTestOverrides(null);
  }

  assert.deepEqual(slackCalls, []);
});
