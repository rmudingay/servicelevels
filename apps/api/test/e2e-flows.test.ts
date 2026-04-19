import assert from "node:assert/strict";
import test from "node:test";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import type { Snapshot } from "@service-levels/shared";
import { loadConfig } from "../src/config.js";
import { MemoryStore } from "../src/store/memory-store.js";
import { registerRoutes } from "../src/routes.js";
import { buildSsoState, setSsoTestOverrides } from "../src/auth/sso.js";
import { processStatusEvents, setNotificationTestOverrides } from "../src/notifications.js";

async function buildTestApp(config = loadConfig({}), store = new MemoryStore(config)) {
  const app = fastify({ logger: false });
  app.register(cookie);
  app.register(formbody);
  app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });
  await registerRoutes(app, store, config);
  return { app, store, config };
}

function authCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  assert.ok(raw, "expected auth cookie to be set");
  return raw.split(";")[0];
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    services: snapshot.services.map((service) => ({ ...service })),
    rawPayload: snapshot.rawPayload
  };
}

test("OIDC callback issues a session cookie that unlocks the protected status route", async () => {
  const config = loadConfig({
    PUBLIC_AUTH_MODE: "oidc",
    APP_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:5173"
  });
  const { app } = await buildTestApp(config);
  const state = buildSsoState(config, {
    provider: "oidc",
    target: "status",
    returnTo: "http://localhost:5173/status"
  });

  setSsoTestOverrides({
    async completeBrowserSsoLogin(store, _overrideConfig, mode, stateToken) {
      assert.equal(mode, "oidc");
      assert.equal(stateToken, state);
      const user = await store.upsertExternalUser({
        username: "oidc-user",
        displayName: "OIDC User",
        email: "oidc@example.invalid",
        authType: "sso"
      });
      return { user, returnTo: "http://localhost:5173/status" };
    }
  });

  try {
    const callback = await app.inject({
      method: "GET",
      url: `/api/v1/auth/sso/oidc/callback?code=stub-code&state=${encodeURIComponent(state)}`
    });

    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "http://localhost:5173/status");
    const cookieHeader = authCookie(callback.headers["set-cookie"]);

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/status?tenant=primary-site",
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(status.statusCode, 200);
    const body = status.json() as { snapshot?: { overallStatus: string } };
    assert.equal(body.snapshot?.overallStatus, "degraded");
  } finally {
    setSsoTestOverrides(null);
    await app.close();
  }
});

test("SAML callback can establish an admin session for the admin console", async () => {
  const config = loadConfig({
    ADMIN_AUTH_MODES: "local,saml",
    APP_BASE_URL: "http://localhost:8080",
    CORS_ORIGIN: "http://localhost:5173"
  });
  const { app } = await buildTestApp(config);
  const state = buildSsoState(config, {
    provider: "saml",
    target: "admin",
    returnTo: "http://localhost:5173/admin"
  });

  setSsoTestOverrides({
    async completeBrowserSsoLogin(store, _overrideConfig, mode, stateToken, requestUrl, samlBody) {
      assert.equal(mode, "saml");
      assert.equal(requestUrl, undefined);
      assert.equal(stateToken, state);
      assert.equal(samlBody?.RelayState, state);
      const user = await store.upsertExternalUser({
        username: "saml-admin",
        displayName: "SAML Admin",
        email: "saml-admin@example.invalid",
        authType: "sso",
        isAdmin: true
      });
      return { user, returnTo: "http://localhost:5173/admin" };
    }
  });

  try {
    const callback = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sso/saml/callback",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      payload: `RelayState=${encodeURIComponent(state)}&SAMLResponse=stub`
    });

    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "http://localhost:5173/admin");
    const cookieHeader = authCookie(callback.headers["set-cookie"]);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/admin/me",
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(me.statusCode, 200);
    const body = me.json() as { user?: { username: string; isAdmin: boolean } };
    assert.equal(body.user?.username, "saml-admin");
    assert.equal(body.user?.isAdmin, true);
  } finally {
    setSsoTestOverrides(null);
    await app.close();
  }
});

test("webhook ingestion updates the current snapshot and opens incidents through the route", async () => {
  const { app, store } = await buildTestApp();
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  await store.createConnector(tenant.id, {
    type: "webhook",
    name: "Ops webhook",
    configJson: JSON.stringify({
      sourceKey: "ops",
      secret: "top-secret"
    }),
    authJson: "{}",
    enabled: true,
    pollIntervalSeconds: 300
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/webhooks/${tenant.slug}/ops`,
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": "top-secret"
      },
      payload: {
        service: {
          slug: "authentication",
          status: "down",
          summary: "Authentication is unavailable"
        }
      }
    });

    assert.equal(response.statusCode, 202);
    const latest = await store.getLatestSnapshot(tenant.id);
    const authService = latest?.services.find((entry) => entry.serviceId === "svc-auth");
    const incidents = await store.getIncidents(tenant.id);
    const authIncident = incidents.find((entry) => entry.serviceId === "svc-auth" && entry.status === "open");
    const connectors = await store.getConnectors(tenant.id);

    assert.equal(authService?.status, "down");
    assert.equal(authService?.summary, "Authentication is unavailable");
    assert.equal(Boolean(authIncident), true);
    assert.equal(Boolean(connectors.find((entry) => entry.type === "webhook" && entry.lastSuccessAt)), true);
  } finally {
    await app.close();
  }
});

test("status events deliver Slack and email notifications for incident transitions", async () => {
  const config = loadConfig({
    SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/global"
  });
  const store = new MemoryStore(config);
  const tenant = (await store.getTenants())[0];
  assert.ok(tenant);

  await store.createSubscription(tenant.id, {
    serviceId: "svc-auth",
    channelType: "slack",
    target: "https://hooks.slack.test/services/subscription",
    enabled: true
  });
  await store.createSubscription(tenant.id, {
    serviceId: "svc-auth",
    channelType: "email",
    target: "ops@example.invalid",
    enabled: true
  });

  const slackMessages: Array<{ webhookUrl: string; text: string }> = [];
  const emailMessages: Array<{ to: string; subject: string; text: string }> = [];
  setNotificationTestOverrides({
    async deliverSlack(webhookUrl, text) {
      slackMessages.push({ webhookUrl, text });
    },
    async deliverEmail(_overrideConfig, to, subject, text) {
      emailMessages.push({ to, subject, text });
    }
  });

  try {
    const previousSnapshot = await store.getLatestSnapshot(tenant.id);
    assert.ok(previousSnapshot);
    const nextSnapshot = cloneSnapshot(previousSnapshot);
    nextSnapshot.id = "snapshot-auth-down";
    nextSnapshot.collectedAt = "2026-04-19T12:10:00.000Z";
    nextSnapshot.overallStatus = "down";
    nextSnapshot.services = nextSnapshot.services.map((service) =>
      service.serviceId === "svc-auth"
        ? {
            ...service,
            status: "down",
            summary: "Authentication is unavailable",
            lastCheckedAt: nextSnapshot.collectedAt
          }
        : service
    );

    await processStatusEvents(config, store, tenant, previousSnapshot, nextSnapshot);

    const incidents = await store.getIncidents(tenant.id);
    const authIncident = incidents.find((entry) => entry.serviceId === "svc-auth" && entry.status === "open");
    assert.equal(Boolean(authIncident), true);
    assert.equal(slackMessages.length, 2);
    assert.equal(slackMessages.some((entry) => entry.webhookUrl === "https://hooks.slack.test/services/subscription"), true);
    assert.equal(slackMessages.some((entry) => entry.webhookUrl === "https://hooks.slack.test/services/global"), true);
    assert.equal(emailMessages.length, 1);
    assert.equal(emailMessages[0]?.to, "ops@example.invalid");
    assert.match(emailMessages[0]?.subject ?? "", /Service Levels application: status update/);
    assert.match(emailMessages[0]?.text ?? "", /Authentication: incident opened/i);
  } finally {
    setNotificationTestOverrides(null);
  }
});
