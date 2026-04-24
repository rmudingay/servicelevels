import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { newDb } from "pg-mem";
import type { Snapshot } from "@service-levels/shared";
import { loadConfig } from "../src/config.js";
import { PostgresStore } from "../src/store/postgres-store.js";

async function createTestSchema(pool: Pool, config: ReturnType<typeof loadConfig>): Promise<void> {
  const statements = [
    "CREATE TABLE app_settings (id integer PRIMARY KEY, app_name text, logo_url text, favicon_url text, theme_default text, auth_settings_json jsonb, notification_settings_json jsonb)",
    "CREATE TABLE tenants (id text PRIMARY KEY, slug text, name text, description text, enabled boolean)",
    "CREATE TABLE tabs (id text PRIMARY KEY, tenant_id text, title text, slug text, sort_order integer, filter_query text, is_global boolean, enabled boolean)",
    "CREATE TABLE services (id text PRIMARY KEY, tenant_id text, name text, slug text, category text, topic text, tags jsonb, source_type text, source_ref text, enabled boolean)",
    "CREATE TABLE connectors (id text PRIMARY KEY, tenant_id text, type text, name text, config_json jsonb, auth_json jsonb, enabled boolean, poll_interval_seconds integer, last_success_at timestamptz, last_error_at timestamptz, last_error_message text)",
    "CREATE TABLE banners (id text PRIMARY KEY, tenant_id text, scope_type text, scope_ref text, title text, message text, severity text, starts_at timestamptz, ends_at timestamptz, active boolean)",
    "CREATE TABLE incidents (id text PRIMARY KEY, tenant_id text, service_id text, title text, description text, status text, opened_at timestamptz, resolved_at timestamptz, source_type text)",
    "CREATE TABLE maintenance_windows (id text PRIMARY KEY, tenant_id text, service_id text, title text, description text, starts_at timestamptz, ends_at timestamptz, status text, created_by text)",
    "CREATE TABLE subscriptions (id text PRIMARY KEY, tenant_id text, service_id text, channel_type text, target text, enabled boolean)",
    "CREATE TABLE colors (tenant_id text, status_key text, color_hex text, label text, PRIMARY KEY (tenant_id, status_key))",
    "CREATE TABLE snapshots (id text PRIMARY KEY, tenant_id text UNIQUE, collected_at timestamptz, overall_status text, services jsonb, raw_payload jsonb)",
    "CREATE TABLE daily_status_summaries (tenant_id text, day text, overall_status text, seconds_by_status jsonb, first_collected_at timestamptz, last_collected_at timestamptz, sample_count integer, PRIMARY KEY (tenant_id, day))",
    "CREATE TABLE users (id text PRIMARY KEY, username text, display_name text, email text, auth_type text, is_admin boolean, enabled boolean, password_hash text)"
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }

  await pool.query(
    "INSERT INTO app_settings (id, app_name, logo_url, favicon_url, theme_default) VALUES (1, $1, $2, $3, $4)",
    [config.appName, config.logoUrl, config.faviconUrl, config.themeDefault]
  );
  await pool.query("INSERT INTO tenants (id, slug, name, description, enabled) VALUES ($1, $2, $3, $4, $5)", [
    "tenant-primary-site",
    "primary-site",
    "Primary Site",
    "Integration test tenant",
    true
  ]);
}

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
    rawPayload: { source: "integration-test" }
  };
}

test("PostgresStore persists connectors, latest snapshots, and daily summaries", async () => {
  const db = newDb();
  const adapter = db.adapters.createPg();
  const config = loadConfig({});
  const pool = new adapter.Pool() as unknown as Pool;
  await createTestSchema(pool, config);

  const store = new PostgresStore(config, "postgres://test", pool);
  await (store as PostgresStore & { loadState(): Promise<void> }).loadState();

  const connector = await store.createConnector("tenant-primary-site", {
    type: "webhook",
    name: "Webhook ingress",
    configJson: "{\"sourceKey\":\"ops\"}",
    authJson: "{}",
    enabled: true,
    pollIntervalSeconds: 300
  });
  await store.saveSnapshot(buildSnapshot("snapshot-integration", "2026-04-20T10:00:00.000Z", "degraded"));
  await store.close();

  const reopened = new PostgresStore(config, "postgres://test", new adapter.Pool() as unknown as Pool);
  await (reopened as PostgresStore & { loadState(): Promise<void> }).loadState();
  try {
    const connectors = await reopened.getConnectors("tenant-primary-site");
    const latest = await reopened.getLatestSnapshot("tenant-primary-site");
    const summaries = await reopened.getDailySummaries("tenant-primary-site");

    assert.equal(connectors.some((entry) => entry.id === connector.id), true);
    assert.equal(latest?.id, "snapshot-integration");
    assert.equal(latest?.overallStatus, "degraded");
    assert.equal(summaries.some((entry) => entry.day === "2026-04-20" && entry.overallStatus === "degraded"), true);

    const updated = await reopened.updateConnector(connector.id, {
      lastSuccessAt: "2026-04-20T10:05:00.000Z",
      lastErrorMessage: null
    });
    assert.equal(updated?.configJson, "{\"sourceKey\":\"ops\"}");
    assert.equal(updated?.lastSuccessAt, "2026-04-20T10:05:00.000Z");

    const secondProcess = new PostgresStore(config, "postgres://test", new adapter.Pool() as unknown as Pool);
    await (secondProcess as PostgresStore & { loadState(): Promise<void> }).loadState();
    try {
      await secondProcess.updateConnector(connector.id, {
        lastSuccessAt: "2026-04-20T10:10:00.000Z"
      });
      const refreshedConnectors = await reopened.getConnectors("tenant-primary-site");
      assert.equal(refreshedConnectors.find((entry) => entry.id === connector.id)?.lastSuccessAt, "2026-04-20T10:10:00.000Z");
    } finally {
      await secondProcess.close();
    }
  } finally {
    await reopened.close();
  }
});
