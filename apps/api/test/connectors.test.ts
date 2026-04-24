import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationConnector, ServiceDefinition, Snapshot, Tenant } from "@service-levels/shared";
import type { ConnectorCollectionContext } from "../src/connectors/shared.js";
import { collectPrometheusConnector } from "../src/connectors/prometheus.js";
import { collectZabbixConnector } from "../src/connectors/zabbix.js";
import { collectPrtgConnector } from "../src/connectors/prtg.js";
import { collectConnector } from "../src/connectors/index.js";
import { demoConnectorOutcome } from "../src/connectors/demo.js";

const tenant: Tenant = {
  id: "tenant-primary-site",
  slug: "primary-site",
  name: "Primary Site",
  description: "Test tenant",
  enabled: true
};

function buildConnector(type: IntegrationConnector["type"], configJson: string, authJson = "{}"): IntegrationConnector {
  return {
    id: `connector-${type}`,
    tenantId: tenant.id,
    type,
    name: `${type} connector`,
    configJson,
    authJson,
    enabled: true,
    pollIntervalSeconds: 300,
    maintenanceEnabled: false,
    maintenanceStartAt: null,
    maintenanceEndAt: null,
    maintenanceMessage: "",
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null
  };
}

function buildContext(connector: IntegrationConnector, service: ServiceDefinition): ConnectorCollectionContext {
  return {
    tenant,
    connector,
    services: [service],
    banners: [],
    tabs: [],
    previousSnapshot: null,
    now: "2026-04-20T10:00:00.000Z"
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("Prometheus connector normalizes threshold-based query results", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ value: [1713607200, "120"] }]
      }
    });

  try {
    const service: ServiceDefinition = {
      id: "svc-prom",
      tenantId: tenant.id,
      name: "Metrics Pipeline",
      slug: "metrics-pipeline",
      category: "infrastructure",
      topic: "metrics",
      tags: ["metrics"],
      sourceType: "prometheus",
      sourceRef: "up",
      enabled: true
    };
    const connector = buildConnector(
      "prometheus",
      JSON.stringify({
        baseUrl: "http://prometheus.example",
        mode: "queries",
        services: [{ slug: "metrics-pipeline", query: "up", downThreshold: 100 }]
      })
    );

    const outcome = await collectPrometheusConnector(buildContext(connector, service));
    assert.equal(outcome.run.status, "success");
    assert.equal(outcome.results[0]?.status, "down");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zabbix connector normalizes active problems into down status", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  const authorizationHeaders: Array<string | undefined> = [];
  globalThis.fetch = async (_url, init) => {
    call += 1;
    const headers = new Headers(init?.headers);
    authorizationHeaders.push(headers.get("authorization") ?? undefined);
    if (call === 1) {
      return jsonResponse({
        jsonrpc: "2.0",
        result: [{ eventid: "1", name: "Authentication unreachable", severity: 5 }]
      });
    }
    return jsonResponse({
      jsonrpc: "2.0",
      result: []
    });
  };

  try {
    const service: ServiceDefinition = {
      id: "svc-auth",
      tenantId: tenant.id,
      name: "Authentication",
      slug: "authentication",
      category: "platform",
      topic: "identity",
      tags: ["critical"],
      sourceType: "zabbix",
      sourceRef: "zabbix:auth",
      enabled: true
    };
    const connector = buildConnector(
      "zabbix",
      JSON.stringify({
        baseUrl: "http://zabbix.example",
        mode: "api",
        services: [{ slug: "authentication", hostIds: [10101] }]
      }),
      JSON.stringify({ token: "static-token" })
    );

    const outcome = await collectZabbixConnector(buildContext(connector, service));
    assert.equal(outcome.run.status, "success");
    assert.equal(outcome.results[0]?.status, "down");
    assert.deepEqual(authorizationHeaders, ["Bearer static-token", "Bearer static-token"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zabbix connector scopes global filters to matching services when services are listed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({
        jsonrpc: "2.0",
        result: [{ eventid: "2", name: "Core network link down", severity: 5 }]
      });
    }
    return jsonResponse({
      jsonrpc: "2.0",
      result: []
    });
  };

  try {
    const authService: ServiceDefinition = {
      id: "svc-auth",
      tenantId: tenant.id,
      name: "Authentication",
      slug: "authentication",
      category: "platform",
      topic: "identity",
      tags: ["critical"],
      sourceType: "zabbix",
      sourceRef: "zabbix:auth",
      enabled: true
    };
    const networkService: ServiceDefinition = {
      id: "svc-network",
      tenantId: tenant.id,
      name: "TN Core Network",
      slug: "tn-core-network",
      category: "infrastructure",
      topic: "network",
      tags: ["network"],
      sourceType: "zabbix",
      sourceRef: "zabbix:tn-core-network",
      enabled: true
    };
    const connector = buildConnector(
      "zabbix",
      JSON.stringify({
        baseUrl: "http://zabbix.example",
        mode: "api",
        tags: [{ tag: "Type", value: "Edge" }],
        services: ["TN Core Network"]
      }),
      JSON.stringify({ token: "static-token" })
    );

    const outcome = await collectZabbixConnector({
      ...buildContext(connector, networkService),
      services: [authService, networkService]
    });
    assert.equal(outcome.run.status, "success");
    assert.equal(outcome.results.length, 1);
    assert.equal(outcome.results[0]?.serviceId, "svc-network");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PRTG connector normalizes sensor warnings into degraded status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      sensors: [],
      result: [
        {
          objid: "2001",
          group: "Network",
          device: "Core Router",
          sensor: "Network Monitor",
          status: "Warning",
          message: "Latency above threshold"
        }
      ]
    });

  try {
    const service: ServiceDefinition = {
      id: "svc-prtg",
      tenantId: tenant.id,
      name: "Network Monitor",
      slug: "network-monitor",
      category: "infrastructure",
      topic: "network",
      tags: ["network"],
      sourceType: "prtg",
      sourceRef: "prtg:network",
      enabled: true
    };
    const connector = buildConnector(
      "prtg",
      JSON.stringify({
        baseUrl: "http://prtg.example",
        mode: "table",
        services: [{ sensor: "Network Monitor" }]
      })
    );

    const outcome = await collectPrtgConnector(buildContext(connector, service));
    assert.equal(outcome.run.status, "success");
    assert.equal(outcome.results[0]?.status, "degraded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("collectConnector skips ingress-only webhook connectors and demo outcomes can simulate errors", async () => {
  const webhookService: ServiceDefinition = {
    id: "svc-webhook",
    tenantId: tenant.id,
    name: "Webhook Sink",
    slug: "webhook-sink",
    category: "platform",
    topic: "automation",
    tags: ["webhook"],
    sourceType: "webhook",
    sourceRef: "ops",
    enabled: true
  };
  const webhookConnector = buildConnector("webhook", JSON.stringify({ sourceKey: "ops" }));
  const context = buildContext(webhookConnector, webhookService);

  const collected = await collectConnector(context);
  assert.equal(collected.results.length, 0);
  assert.equal(collected.run.status, "success");
  assert.equal((collected.rawPayload as { skipped?: boolean }).skipped, true);

  const errorOutcome = demoConnectorOutcome(
    {
      ...context,
      connector: {
        ...webhookConnector,
        type: "prometheus",
        name: "Demo collector"
      }
    },
    JSON.stringify({
      simulateError: true,
      errorMessage: "demo failure"
    })
  );
  assert.equal(errorOutcome.run.status, "error");
  assert.equal(errorOutcome.run.errorMessage, "demo failure");
});
