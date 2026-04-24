import assert from "node:assert/strict";
import test from "node:test";
import fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { registerObservability } from "../src/observability.js";
import { registerRoutes } from "../src/routes.js";
import { signAuthToken } from "../src/auth.js";
import { MemoryStore } from "../src/store/memory-store.js";

async function buildRouteApp(config = loadConfig({}), store = new MemoryStore(config)): Promise<{ app: FastifyInstance; store: MemoryStore; config: AppConfig }> {
  const app = fastify({ logger: false });
  app.register(cookie);
  app.register(formbody);
  app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });
  registerObservability(app, config.appName);
  await registerRoutes(app, store, config);
  return { app, store, config };
}

function authCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  assert.ok(raw, "expected auth cookie to be set");
  return raw.split(";")[0];
}

async function loginAsAdmin(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      mode: "local",
      username: "admin",
      password: "change-me"
    }
  });
  assert.equal(response.statusCode, 200);
  return authCookie(response.headers["set-cookie"]);
}

test("status API exposes the current snapshot and daily summaries", async () => {
  const app = await buildApp(loadConfig({}));
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status?tenant=primary-site"
    });

    assert.equal(response.statusCode, 200);

    const body = response.json() as { snapshot?: { id: string }; dailySummaries?: Array<{ day: string }> };
    assert.equal(Boolean(body.snapshot), true);
    assert.equal(Array.isArray(body.dailySummaries), true);
    assert.equal(body.dailySummaries?.length > 0, true);
  } finally {
    await app.close();
  }
});

test("observability endpoints expose liveness, readiness, and Prometheus metrics", async () => {
  const app = await buildApp(loadConfig({}));
  try {
    const live = await app.inject({
      method: "GET",
      url: "/livez"
    });
    const ready = await app.inject({
      method: "GET",
      url: "/readyz"
    });
    const metrics = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    assert.equal(live.statusCode, 200);
    assert.equal(ready.statusCode, 200);
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /service_levels_http_requests_total/);
    assert.match(metrics.body, /service_levels_app_info/);
  } finally {
    await app.close();
  }
});

test("public route set exposes metadata, feed, tenant pages, and developer info", async () => {
  const { app } = await buildRouteApp();
  try {
    const [meta, options, rss, incidents, maintenance, branding, devInfo] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/meta" }),
      app.inject({ method: "GET", url: "/api/v1/auth/options" }),
      app.inject({ method: "GET", url: "/api/v1/rss?tenant=primary-site" }),
      app.inject({ method: "GET", url: "/api/v1/tenants/primary-site/incidents" }),
      app.inject({ method: "GET", url: "/api/v1/tenants/primary-site/maintenance" }),
      app.inject({ method: "GET", url: "/api/v1/tenants/primary-site/branding" }),
      app.inject({ method: "GET", url: "/api/v1/dev/info" })
    ]);

    assert.equal(meta.statusCode, 200);
    assert.equal(options.statusCode, 200);
    assert.equal(rss.statusCode, 200);
    assert.equal(incidents.statusCode, 200);
    assert.equal(maintenance.statusCode, 200);
    assert.equal(branding.statusCode, 200);
    assert.equal(devInfo.statusCode, 200);
    assert.match(rss.body, /<rss version="2.0">/);
    assert.match(rss.body, /Current status: degraded|Current status: maintenance|Current status: down|Current status: healthy/);
    assert.equal((options.json() as { adminAuthModes: string[] }).adminAuthModes.includes("local"), true);
    assert.equal((devInfo.json() as { name: string }).name, "Service Levels application");
  } finally {
    await app.close();
  }
});

test("status access guard enforces local auth and allows IP-based access when configured", async () => {
  const localConfig = loadConfig({ PUBLIC_AUTH_MODE: "local" });
  const localApp = await buildRouteApp(localConfig);
  try {
    const denied = await localApp.app.inject({
      method: "GET",
      url: "/api/v1/status"
    });
    assert.equal(denied.statusCode, 401);

    const cookieHeader = await loginAsAdmin(localApp.app);
    const allowed = await localApp.app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(allowed.statusCode, 200);
  } finally {
    await localApp.app.close();
  }

  const ipConfig = loadConfig({
    PUBLIC_AUTH_MODE: "ip",
    ALLOWED_IP_RANGES: "127.0.0.1/32"
  });
  const ipApp = await buildRouteApp(ipConfig);
  try {
    const response = await ipApp.app.inject({
      method: "GET",
      url: "/api/v1/status"
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await ipApp.app.close();
  }
});

test("login, logout, and SSO entry validation behave as expected", async () => {
  const { app } = await buildRouteApp(
    loadConfig({
      ADMIN_AUTH_MODES: "local,oidc",
      PUBLIC_AUTH_MODE: "public"
    })
  );
  try {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/v1/admin/me"
    });
    assert.equal(unauthorized.statusCode, 401);

    const invalidLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        mode: "oidc"
      }
    });
    assert.equal(invalidLogin.statusCode, 400);

    const badStart = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sso/nope/start"
    });
    assert.equal(badStart.statusCode, 400);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        mode: "local",
        username: "admin",
        password: "change-me"
      }
    });
    assert.equal(login.statusCode, 200);
    const cookieHeader = authCookie(login.headers["set-cookie"]);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/admin/me",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(me.statusCode, 200);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(logout.statusCode, 200);

    const samlMetadata = await app.inject({
      method: "GET",
      url: "/api/v1/auth/sso/saml/metadata"
    });
    assert.equal(samlMetadata.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("main admin can manage users end to end", async () => {
  const { app } = await buildRouteApp();
  try {
    const cookieHeader = await loginAsAdmin(app);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(list.statusCode, 200);

    const badCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        username: "ops"
      }
    });
    assert.equal(badCreate.statusCode, 400);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        username: "ops",
        displayName: "Operations",
        email: "ops@example.org",
        authType: "local",
        password: "ops-secret",
        enabled: true
      }
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.json() as { id: string };

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${createdBody.id}`,
      headers: {
        cookie: cookieHeader
      },
      payload: {
        displayName: "Operations Team",
        enabled: false
      }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.json() as { displayName: string }).displayName, "Operations Team");

    const promoted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${createdBody.id}/promote`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal((promoted.json() as { isAdmin: boolean }).isAdmin, true);

    const demoted = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${createdBody.id}/demote`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(demoted.statusCode, 200);
    assert.equal((demoted.json() as { isAdmin: boolean }).isAdmin, false);

    const bootstrapDemote = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users/user-admin/demote",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(bootstrapDemote.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("non-bootstrap admins are blocked from bootstrap-only user management", async () => {
  const { app, store, config } = await buildRouteApp();
  const user = await store.upsertExternalUser({
    username: "delegate-admin",
    displayName: "Delegate Admin",
    email: "delegate@example.org",
    authType: "sso",
    isAdmin: true
  });
  const cookie = signAuthToken(config, {
    userId: user.id,
    username: user.username,
    isAdmin: true
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: {
        cookie: `service_levels_admin_token=${cookie}`
      },
      payload: {
        username: "blocked-user",
        authType: "local",
        password: "secret"
      }
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("main admin can configure authentication providers and SMTP settings", async () => {
  const { app } = await buildRouteApp();
  try {
    const cookieHeader = await loginAsAdmin(app);

    const initialSettings = await app.inject({
      method: "GET",
      url: "/api/v1/admin/platform-settings",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(initialSettings.statusCode, 200);

    const current = initialSettings.json() as {
      auth: {
        ldap: Record<string, unknown>;
        remoteAuth: Record<string, unknown>;
        oidc: Record<string, unknown>;
        saml: Record<string, unknown>;
      };
      notifications: Record<string, unknown>;
    };

    const updatedSettings = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/platform-settings",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        auth: {
          publicAuthMode: "local",
          adminAuthModes: ["local", "oidc"],
          allowedIpRanges: ["127.0.0.1/32"],
          ldap: current.auth.ldap,
          remoteAuth: current.auth.remoteAuth,
          oidc: {
            ...current.auth.oidc,
            issuerUrl: "https://idp.example.org",
            clientId: "service-levels"
          },
          saml: current.auth.saml
        },
        notifications: {
          ...current.notifications,
          smtpHost: "smtp.example.org",
          smtpPort: 2525,
          smtpFrom: "status@example.org"
        }
      }
    });
    assert.equal(updatedSettings.statusCode, 200);
    assert.equal((updatedSettings.json() as { auth: { publicAuthMode: string }; notifications: { smtpHost: string } }).auth.publicAuthMode, "local");
    assert.equal((updatedSettings.json() as { notifications: { smtpHost: string } }).notifications.smtpHost, "smtp.example.org");

    const options = await app.inject({
      method: "GET",
      url: "/api/v1/auth/options"
    });
    assert.equal(options.statusCode, 200);
    assert.equal((options.json() as { publicAuthMode: string; adminAuthModes: string[] }).publicAuthMode, "local");
    assert.equal((options.json() as { adminAuthModes: string[] }).adminAuthModes.includes("oidc"), true);

    const deniedStatus = await app.inject({
      method: "GET",
      url: "/api/v1/status"
    });
    assert.equal(deniedStatus.statusCode, 401);

    const allowedStatus = await app.inject({
      method: "GET",
      url: "/api/v1/status",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(allowedStatus.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("admin CRUD routes manage connectors, tabs, banners, subscriptions, branding, colors, and summaries", async () => {
  const { app } = await buildRouteApp();
  try {
    const cookieHeader = await loginAsAdmin(app);

    const tenantCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tenants",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        name: "Secondary Site",
        slug: "secondary-site",
        description: "Additional logical location",
        enabled: true
      }
    });
    assert.equal(tenantCreate.statusCode, 201);
    const tenant = tenantCreate.json() as { id: string; slug: string };

    const tenantPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tenants/${tenant.id}`,
      headers: {
        cookie: cookieHeader
      },
      payload: {
        description: "Updated logical location",
        enabled: false
      }
    });
    assert.equal(tenantPatch.statusCode, 200);

    const connectorCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/connectors",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        tenantSlug: "primary-site",
        type: "webhook",
        name: "Ops Webhook",
        configJson: "{\"secret\":\"abc\"}",
        authJson: "{}",
        enabled: true,
        pollIntervalSeconds: 600
      }
    });
    assert.equal(connectorCreate.statusCode, 201);
    const connector = connectorCreate.json() as { id: string };

    const connectorPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/connectors/${connector.id}`,
      headers: {
        cookie: cookieHeader
      },
      payload: {
        name: "Ops Webhook Updated",
        enabled: false
      }
    });
    assert.equal(connectorPatch.statusCode, 200);

    const connectorList = await app.inject({
      method: "GET",
      url: "/api/v1/admin/connectors?tenant=primary-site",
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(connectorList.statusCode, 200);

    const tabCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tabs",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        tenantSlug: "primary-site",
        title: "Critical",
        filterQuery: "tag:critical",
        isGlobal: false
      }
    });
    assert.equal(tabCreate.statusCode, 201);

    const bannerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/banners",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        tenantSlug: "primary-site",
        scopeType: "tenant",
        scopeRef: "primary-site",
        title: "Operator update",
        message: "Planned failover validation.",
        severity: "maintenance"
      }
    });
    assert.equal(bannerCreate.statusCode, 201);
    const banner = bannerCreate.json() as { id: string; active: boolean };

    const bannerToggle = await app.inject({
      method: "POST",
      url: `/api/v1/admin/banners/${banner.id}/toggle`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(bannerToggle.statusCode, 200);
    assert.equal((bannerToggle.json() as { active: boolean }).active, false);

    const bannerPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/banners/${banner.id}`,
      headers: {
        cookie: cookieHeader
      },
      payload: {
        message: "Failover validation completed.",
        severity: "healthy",
        active: true
      }
    });
    assert.equal(bannerPatch.statusCode, 200);
    assert.equal((bannerPatch.json() as { message: string; severity: string; active: boolean }).severity, "healthy");

    const subscriptionCreate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/subscriptions",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        tenantSlug: "primary-site",
        channelType: "email",
        target: "ops@example.org",
        enabled: true
      }
    });
    assert.equal(subscriptionCreate.statusCode, 201);
    const subscription = subscriptionCreate.json() as { id: string };

    const subscriptionDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/subscriptions/${subscription.id}`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(subscriptionDelete.statusCode, 200);

    const brandingUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/branding",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        appName: "Service Levels",
        themeDefault: "light"
      }
    });
    assert.equal(brandingUpdate.statusCode, 200);

    const colorsUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/colors",
      headers: {
        cookie: cookieHeader
      },
      payload: {
        tenantSlug: "primary-site",
        colors: [
          { statusKey: "healthy", colorHex: "#00AA00", label: "Healthy" },
          { statusKey: "degraded", colorHex: "#FFCC00", label: "Degraded" },
          { statusKey: "down", colorHex: "#FF0000", label: "Down" },
          { statusKey: "maintenance", colorHex: "#0066FF", label: "Maintenance" },
          { statusKey: "unknown", colorHex: "#999999", label: "Unknown" }
        ]
      }
    });
    assert.equal(colorsUpdate.statusCode, 200);

    const [tenants, tabs, banners, subscriptions, branding, colors, bootstrap, summary, collectionHealth] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/admin/tenants", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/tabs?tenant=primary-site", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/banners?tenant=primary-site", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/subscriptions?tenant=primary-site", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/branding", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/colors?tenant=primary-site", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/bootstrap", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/summary", headers: { cookie: cookieHeader } }),
      app.inject({ method: "GET", url: "/api/v1/admin/collection-health", headers: { cookie: cookieHeader } })
    ]);

    assert.equal(tenants.statusCode, 200);
    assert.equal(tabs.statusCode, 200);
    assert.equal(banners.statusCode, 200);
    assert.equal(subscriptions.statusCode, 200);
    assert.equal(branding.statusCode, 200);
    assert.equal(colors.statusCode, 200);
    assert.equal(bootstrap.statusCode, 200);
    assert.equal(summary.statusCode, 200);
    assert.equal(collectionHealth.statusCode, 200);
    assert.equal((bootstrap.json() as { connectorCount: number }).connectorCount > 0, true);

    const bannerDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/banners/${banner.id}`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(bannerDelete.statusCode, 200);

    const connectorDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/connectors/${connector.id}`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(connectorDelete.statusCode, 200);

    const tenantDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tenants/${tenant.id}`,
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(tenantDelete.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("webhook and not-found routes return useful errors on invalid input", async () => {
  const { app } = await buildRouteApp();
  try {
    const unknownTenant = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/unknown/source",
      payload: {}
    });
    assert.equal(unknownTenant.statusCode, 404);

    const missingSourceConfig = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/primary-site/missing",
      payload: {}
    });
    assert.equal(missingSourceConfig.statusCode, 400);

    const apiNotFound = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist"
    });
    assert.equal(apiNotFound.statusCode, 404);
  } finally {
    await app.close();
  }
});
