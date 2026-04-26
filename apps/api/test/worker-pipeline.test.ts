import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";
import { collectAndPersistTenant, collectTenantCycle, ingestWebhookEvent, persistTenantCycle } from "../src/worker/pipeline.js";

test("collectTenantCycle reuses the previous snapshot when no enabled connectors are available", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  for (const connector of await store.getConnectors(tenant.id)) {
    await store.updateConnector(connector.id, { enabled: false });
  }

  const cycle = await collectTenantCycle(store, tenant);

  assert.equal(cycle.changed, true);
  assert.ok(cycle.snapshot);
  assert.equal(cycle.connectorRuns.length, 0);
  assert.equal(cycle.snapshot?.services.length, (await store.getServices(tenant.id)).filter((entry) => entry.enabled).length);
});

test("persistTenantCycle stores snapshots and updates connector success/error timestamps", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);
  const connector = await store.createConnector(tenant.id, {
    type: "prometheus",
    name: "Synthetic connector",
    configJson: "{}",
    authJson: "{}",
    enabled: true,
    pollIntervalSeconds: 300
  });
  assert.ok(connector);
  const previous = await store.getLatestSnapshot(tenant.id);
  assert.ok(previous);

  const snapshot = {
    ...previous,
    id: "snapshot-persist",
    collectedAt: "2026-04-20T13:00:00.000Z",
    overallStatus: "healthy" as const,
    services: previous.services.map((entry) => ({
      ...entry,
      status: "healthy" as const,
      summary: "Recovered",
      lastCheckedAt: "2026-04-20T13:00:00.000Z"
    }))
  };

  await persistTenantCycle(config, store, {
    tenant,
    connectors: [connector],
    tabs: await store.getTabs(tenant.id),
    services: await store.getServices(tenant.id),
    banners: await store.getBanners(tenant.id),
    previousSnapshot: previous,
    connectorRuns: [
      {
        connector,
        status: "error",
        errorMessage: "transient failure",
        touchedAt: "2026-04-20T13:00:00.000Z"
      },
      {
        connector,
        status: "success",
        touchedAt: "2026-04-20T13:05:00.000Z"
      }
    ],
    snapshot,
    changed: true
  });

  const updatedConnector = await store.getConnectors(tenant.id);
  assert.equal(updatedConnector[0]?.lastErrorAt, "2026-04-20T13:00:00.000Z");
  assert.equal(updatedConnector[0]?.lastErrorMessage, "transient failure");
  assert.equal(updatedConnector[0]?.lastSuccessAt, null);
  assert.equal((await store.getLatestSnapshot(tenant.id))?.id, "snapshot-persist");
});

test("collectAndPersistTenant saves newly collected state for active connectors", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("prometheus")) {
      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ value: [1713607200, "1"] }]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("zabbix")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        result: [
          {
            objid: "2001",
            sensor: "Network Monitor",
            status: "Up",
            message: "OK"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const cycle = await collectAndPersistTenant(config, store, tenant);
    assert.equal(cycle.changed, true);
    assert.equal((await store.getLatestSnapshot(tenant.id))?.tenantId, tenant.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collectTenantCycle marks connector-owned services as maintenance during connector maintenance", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);
  const prometheusService = (await store.getServices(tenant.id)).find((entry) => entry.sourceType === "prometheus");
  assert.ok(prometheusService);

  await store.createConnector(tenant.id, {
    type: "prometheus",
    name: "Prometheus planned maintenance",
    configJson: "{}",
    authJson: "{}",
    enabled: true,
    pollIntervalSeconds: 300,
    maintenanceEnabled: true,
    maintenanceStartAt: "2000-01-01T00:00:00.000Z",
    maintenanceEndAt: "2999-01-01T00:00:00.000Z",
    maintenanceMessage: "Prometheus is paused during platform maintenance."
  });

  const cycle = await collectTenantCycle(store, tenant);
  const serviceStatus = cycle.snapshot?.services.find((entry) => entry.serviceId === prometheusService.id);

  assert.equal(cycle.connectorRuns[0]?.status, "success");
  assert.equal(serviceStatus?.status, "maintenance");
  assert.equal(serviceStatus?.summary, "Prometheus is paused during platform maintenance.");
});

test("collectTenantCycle marks connector-owned services as no data when collection fails", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);
  const zabbixService = (await store.getServices(tenant.id)).find((entry) => entry.sourceType === "zabbix");
  assert.ok(zabbixService);
  const zabbixConnector = await store.createConnector(tenant.id, {
    type: "zabbix",
    name: "failing zabbix",
    configJson: JSON.stringify({
      baseUrl: "https://zabbix.example/api_jsonrpc.php",
      mode: "api",
      services: [{ name: zabbixService.name, hostIds: [10101] }]
    }),
    authJson: JSON.stringify({ token: "static-token" }),
    enabled: true,
    pollIntervalSeconds: 300
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND zabbix.example"), { code: "ENOTFOUND" });
    throw Object.assign(new TypeError("fetch failed"), { cause });
  };

  try {
    const cycle = await collectTenantCycle(store, tenant);
    const serviceStatus = cycle.snapshot?.services.find((entry) => entry.serviceId === zabbixService.id);

    assert.equal(cycle.connectorRuns.some((run) => run.connector.id === zabbixConnector.id && run.status === "error"), true);
    assert.equal(serviceStatus?.status, "unknown");
    assert.match(serviceStatus?.summary ?? "", /No data: Request to/);
    assert.match(serviceStatus?.summary ?? "", /ENOTFOUND/);
    assert.equal(cycle.snapshot?.overallStatus, "unknown");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestWebhookEvent applies overall status to all services when no service match is provided", async () => {
  const config = loadConfig({});
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  await store.createConnector(tenant.id, {
    type: "webhook",
    name: "Fallback webhook",
    configJson: JSON.stringify({
      sourceKey: "fallback",
      secret: "shared-secret"
    }),
    authJson: "{}",
    enabled: true,
    pollIntervalSeconds: 300
  });

  const result = await ingestWebhookEvent(
    config,
    store,
    tenant,
    "fallback",
    {
      overallStatus: "down",
      summary: "Site-wide outage"
    },
    {
      "x-webhook-secret": "shared-secret"
    }
  );

  assert.equal(result.snapshot.overallStatus, "down");
  assert.equal(result.snapshot.services.length, (await store.getServices(tenant.id)).filter((entry) => entry.enabled).length);
  assert.equal(result.snapshot.services.every((entry) => entry.status === "down" || entry.status === "degraded" || entry.status === "maintenance" || entry.status === "healthy" || entry.status === "unknown"), true);
});
