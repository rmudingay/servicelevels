import type { FastifyInstance } from "fastify";
import { signAuthToken, clearAuthCookie, requireAdmin, statusAccessGuard, getCookieName, readAuthToken } from "./auth.js";
import { authenticateLogin, authModeLabels, availableAuthModes, type LoginMode } from "./auth/providers.js";
import {
  browserRedirectModes,
  completeBrowserSsoLogin,
  createBrowserRedirectUrl,
  isBrowserRedirectMode,
  parseSsoState,
  type BrowserSsoMode,
  type LoginTarget,
  getSamlMetadata
} from "./auth/sso.js";
import { buildStatusFeed } from "./notifications.js";
import type { AppConfig } from "./config.js";
import { normalizePlatformSettings, resolveEffectiveConfig } from "./settings.js";
import type { StatusRepository } from "./store/types.js";
import { nowIso, slugify } from "./utils.js";
import type { Banner, StatusLevel, Tenant } from "@service-levels/shared";
import { ingestWebhookEvent } from "./worker/pipeline.js";

async function buildRss(store: StatusRepository, tenantSlug?: string): Promise<string> {
  const view = await store.getStatusView(tenantSlug);
  const tenant = view.tenants[0];
  const title = view.meta.appName;
  const description = tenant ? `Status feed for ${tenant.name}` : "Service status feed";
  const items = [
    ...(view.snapshot
      ? [
          {
            title: `Current status: ${view.snapshot.overallStatus}`,
            description: `Overall status is ${view.snapshot.overallStatus} as of ${view.snapshot.collectedAt}`,
            guid: view.snapshot.id,
            pubDate: view.snapshot.collectedAt
          }
        ]
      : []),
    ...view.banners.filter((banner) => banner.active).map((banner) => ({
      title: banner.title,
      description: banner.message,
      guid: banner.id,
      pubDate: banner.startsAt ?? nowIso()
    }))
  ];

  const itemXml = items
    .map(
      (item) => `
      <item>
        <title>${escapeXml(item.title)}</title>
        <description>${escapeXml(item.description)}</description>
        <guid>${escapeXml(item.guid)}</guid>
        <pubDate>${escapeXml(item.pubDate)}</pubDate>
      </item>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0">
    <channel>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(description)}</description>
      <link>http://localhost:8080/</link>
      ${itemXml}
    </channel>
  </rss>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseTenantSlug(query: Record<string, unknown>): string | undefined {
  const value = query.tenant;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseTenantSlugParam(params: Record<string, unknown>): string | undefined {
  const value = params.tenantSlug;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      const first = value.find((entry): entry is string => typeof entry === "string");
      if (first) {
        normalized[key.toLowerCase()] = first;
      }
    }
  }
  return normalized;
}

function computeNextDueAt(lastSuccessAt: string | null, lastErrorAt: string | null, pollIntervalSeconds: number): string | null {
  const anchor = lastSuccessAt ?? lastErrorAt;
  if (!anchor) {
    return null;
  }
  const due = new Date(anchor);
  due.setSeconds(due.getSeconds() + pollIntervalSeconds);
  return due.toISOString();
}

function isMainAdmin(request: { user?: { username: string } }, config: AppConfig): boolean {
  return request.user?.username === config.adminUsername;
}

export async function registerRoutes(app: FastifyInstance, store: StatusRepository, config: AppConfig): Promise<void> {
  const effectiveConfig = () => resolveEffectiveConfig(config, store);

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/api/v1/meta", async () => store.getMeta());

  app.get("/api/v1/auth/options", async () => {
    const runtimeConfig = await effectiveConfig();
    return {
      publicAuthMode: runtimeConfig.publicAuthMode,
      adminAuthModes: availableAuthModes(runtimeConfig),
      redirectAuthModes: browserRedirectModes(),
      labels: authModeLabels()
    };
  });

  app.get(
    "/api/v1/status",
    {
      preHandler: statusAccessGuard(store, config)
    },
    async (request) => store.getStatusView(parseTenantSlug(request.query as Record<string, unknown>))
  );

  app.get("/api/v1/tenants/:tenantSlug/incidents", async (request) => {
    const params = request.params as Record<string, unknown>;
    return store.getIncidents(parseTenantSlugParam(params));
  });

  app.get("/api/v1/tenants/:tenantSlug/maintenance", async (request) => {
    const params = request.params as Record<string, unknown>;
    return store.getMaintenanceWindows(parseTenantSlugParam(params));
  });

  app.get("/api/v1/tenants/:tenantSlug/branding", async (request) => {
    const params = request.params as Record<string, unknown>;
    const tenantSlug = parseTenantSlugParam(params);
    return { branding: await store.getBranding(), tenantSlug };
  });

  app.get("/api/v1/rss", async (request, reply) => {
    const xml = await buildStatusFeed(config, store, parseTenantSlug(request.query as Record<string, unknown>));
    reply.header("content-type", "application/rss+xml; charset=utf-8").send(xml);
  });

  app.post("/api/v1/webhooks/:tenantSlug/:source", async (request, reply) => {
    const params = request.params as { tenantSlug?: string; source?: string };
    const query = request.query as { token?: string };
    const tenantSlug = params.tenantSlug;
    const source = params.source ?? "";
    if (!tenantSlug || !source) {
      reply.code(400).send({ error: "Tenant and source are required" });
      return;
    }

    const tenant = (await store.getTenants()).find((entry) => entry.slug === tenantSlug);
    if (!tenant) {
      reply.code(404).send({ error: "Tenant not found" });
      return;
    }

    try {
      const result = await ingestWebhookEvent(await effectiveConfig(), store, tenant, source, request.body, normalizeHeaders(request.headers), query.token);
      reply.code(202).send({
        ok: true,
        tenant: result.tenant,
        connectorId: result.connector.id,
        snapshot: result.snapshot
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Webhook ingestion failed" });
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = request.body as {
      mode?: LoginMode;
      username?: string;
      password?: string;
      token?: string;
      accessToken?: string;
      assertion?: string;
    };
    if (body.mode && isBrowserRedirectMode(body.mode)) {
      reply.code(400).send({ error: "Use the browser redirect SSO start route for this authentication mode" });
      return;
    }
    const runtimeConfig = await effectiveConfig();
    const user = await authenticateLogin(store, runtimeConfig, body);
    if (!user) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    const token = signAuthToken(runtimeConfig, {
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin
    });
    reply.setCookie(getCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/"
    });
    reply.send({ ok: true, user });
  });

  app.get("/api/v1/auth/sso/:mode/start", async (request, reply) => {
    const params = request.params as { mode: BrowserSsoMode };
    const query = request.query as { target?: LoginTarget; returnTo?: string };
    if (!isBrowserRedirectMode(params.mode)) {
      reply.code(400).send({ error: "Unsupported SSO mode" });
      return;
    }
    const target = query.target === "admin" ? "admin" : "status";
    try {
      const redirectUrl = await createBrowserRedirectUrl(await effectiveConfig(), params.mode, target, query.returnTo);
      reply.redirect(redirectUrl);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to start single sign-on" });
    }
  });

  app.get("/api/v1/auth/sso/oidc/callback", async (request, reply) => {
    try {
      const runtimeConfig = await effectiveConfig();
      const currentUrl = new URL(request.raw.url ?? "/api/v1/auth/sso/oidc/callback", runtimeConfig.appBaseUrl);
      const stateToken = currentUrl.searchParams.get("state") ?? undefined;
      const state = parseSsoState(runtimeConfig, stateToken);
      if (!state) {
        throw new Error("Invalid authentication transaction");
      }
      const result = await completeBrowserSsoLogin(store, runtimeConfig, state.provider, stateToken, currentUrl);
      const token = signAuthToken(runtimeConfig, {
        userId: result.user.id,
        username: result.user.username,
        isAdmin: result.user.isAdmin
      });
      reply.setCookie(getCookieName(), token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
      reply.redirect(result.returnTo);
    } catch (error) {
      reply.code(401).send({ error: error instanceof Error ? error.message : "OIDC authentication failed" });
    }
  });

  app.post("/api/v1/auth/sso/saml/callback", async (request, reply) => {
    try {
      const runtimeConfig = await effectiveConfig();
      const body = request.body as Record<string, string>;
      const stateToken = body.RelayState ?? body.relayState;
      const result = await completeBrowserSsoLogin(store, runtimeConfig, "saml", stateToken, undefined, body);
      const token = signAuthToken(runtimeConfig, {
        userId: result.user.id,
        username: result.user.username,
        isAdmin: result.user.isAdmin
      });
      reply.setCookie(getCookieName(), token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      });
      reply.redirect(result.returnTo);
    } catch (error) {
      reply.code(401).send({ error: error instanceof Error ? error.message : "SAML authentication failed" });
    }
  });

  app.get("/api/v1/auth/sso/saml/metadata", async (_request, reply) => {
    try {
      const metadata = await getSamlMetadata(await effectiveConfig());
      reply.type("application/xml; charset=utf-8").send(metadata);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : "SAML is not configured" });
    }
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    clearAuthCookie(reply);
    reply.send({ ok: true });
  });

  app.get("/api/v1/admin/me", { preHandler: requireAdmin(store, config) }, async (request) => {
    const context = readAuthToken(config, request.cookies[getCookieName()]);
    return { user: context, meta: await store.getMeta() };
  });

  app.get("/api/v1/admin/users", { preHandler: requireAdmin(store, config) }, async () => store.listUsers());

  app.get("/api/v1/admin/platform-settings", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    return store.getPlatformSettings();
  });

  app.put("/api/v1/admin/platform-settings", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    const current = await store.getPlatformSettings();
    const settings = normalizePlatformSettings(request.body, current);
    if (settings.auth.adminAuthModes.length === 0) {
      reply.code(400).send({ error: "At least one admin authentication mode is required" });
      return;
    }
    return store.updatePlatformSettings(settings);
  });

  app.post("/api/v1/admin/users", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    const body = request.body as {
      username?: string;
      displayName?: string;
      email?: string;
      authType?: "local" | "ldap" | "sso";
      password?: string;
      enabled?: boolean;
    };
    if (!body.username || !body.authType) {
      reply.code(400).send({ error: "Username and auth type are required" });
      return;
    }
    if (body.authType === "local" && !body.password) {
      reply.code(400).send({ error: "Password is required for local accounts" });
      return;
    }
    const created = await store.createUser({
      username: body.username,
      displayName: body.displayName ?? body.username,
      email: body.email ?? "",
      authType: body.authType,
      isAdmin: false,
      enabled: body.enabled ?? true,
      password: body.password ?? null
    });
    reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/users/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    const params = request.params as { id: string };
    const body = request.body as Partial<{
      username: string;
      displayName: string;
      email: string;
      authType: "local" | "ldap" | "sso";
      enabled: boolean;
      password: string;
    }>;
    const updated = await store.updateUser(params.id, body);
    if (!updated) {
      reply.code(404).send({ error: "User not found" });
      return;
    }
    reply.send(updated);
  });

  app.post("/api/v1/admin/users/:id/promote", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    const params = request.params as { id: string };
    const updated = await store.setUserAdmin(params.id, true);
    if (!updated) {
      reply.code(404).send({ error: "User not found" });
      return;
    }
    reply.send(updated);
  });

  app.post("/api/v1/admin/users/:id/demote", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    if (!isMainAdmin(request, config)) {
      reply.code(403).send({ error: "Main administrator access required" });
      return;
    }
    const params = request.params as { id: string };
    const user = await store.findUserById(params.id);
    if (!user) {
      reply.code(404).send({ error: "User not found" });
      return;
    }
    if (user.username === config.adminUsername) {
      reply.code(400).send({ error: "Bootstrap administrator cannot be demoted" });
      return;
    }
    const updated = await store.setUserAdmin(params.id, false);
    reply.send(updated);
  });

  app.get("/api/v1/admin/tenants", { preHandler: requireAdmin(store, config) }, async () => store.getTenants());

  app.post("/api/v1/admin/tenants", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as Partial<Pick<Tenant, "slug" | "name" | "description" | "enabled">>;
    const name = body.name?.trim();
    const slug = slugify(body.slug?.trim() || name || "");
    if (!name || !slug) {
      reply.code(400).send({ error: "Tenant name is required" });
      return;
    }
    const existing = (await store.getTenants()).find((tenant) => tenant.slug === slug);
    if (existing) {
      reply.code(409).send({ error: "Tenant slug already exists" });
      return;
    }
    const tenant = await store.createTenant({
      slug,
      name,
      description: body.description?.trim() ?? "",
      enabled: body.enabled ?? true
    });
    reply.code(201).send(tenant);
  });

  app.patch("/api/v1/admin/tenants/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as Partial<Pick<Tenant, "slug" | "name" | "description" | "enabled">>;
    const patch: Partial<Tenant> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        reply.code(400).send({ error: "Tenant name cannot be empty" });
        return;
      }
      patch.name = name;
    }
    if (body.slug !== undefined) {
      const slug = slugify(body.slug);
      if (!slug) {
        reply.code(400).send({ error: "Tenant slug cannot be empty" });
        return;
      }
      const duplicate = (await store.getTenants()).find((tenant) => tenant.slug === slug && tenant.id !== params.id);
      if (duplicate) {
        reply.code(409).send({ error: "Tenant slug already exists" });
        return;
      }
      patch.slug = slug;
    }
    if (body.description !== undefined) {
      patch.description = body.description;
    }
    if (body.enabled !== undefined) {
      patch.enabled = body.enabled;
    }
    const updated = await store.updateTenant(params.id, patch);
    if (!updated) {
      reply.code(404).send({ error: "Tenant not found" });
      return;
    }
    reply.send(updated);
  });

  app.delete("/api/v1/admin/tenants/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const tenants = await store.getTenants();
    if (tenants.length <= 1) {
      reply.code(400).send({ error: "Cannot delete the last tenant" });
      return;
    }
    const removed = await store.deleteTenant(params.id);
    if (!removed) {
      reply.code(404).send({ error: "Tenant not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.get("/api/v1/admin/tabs", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getTabs(tenantId);
  });

  app.get("/api/v1/admin/connectors", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getConnectors(tenantId);
  });

  app.post("/api/v1/admin/connectors", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as {
      tenantSlug?: string;
      type?: "zabbix" | "prometheus" | "prtg" | "webhook";
      name?: string;
      configJson?: string;
      authJson?: string;
      enabled?: boolean;
      pollIntervalSeconds?: number;
    };
    const tenants = await store.getTenants();
    const tenant = body.tenantSlug ? tenants.find((entry) => entry.slug === body.tenantSlug) : tenants[0];
    if (!tenant || !body.name || !body.type) {
      reply.code(400).send({ error: "Tenant, type, and name are required" });
      return;
    }
    const connector = await store.createConnector(tenant.id, {
      type: body.type as "zabbix" | "prometheus" | "prtg" | "webhook",
      name: body.name,
      configJson: body.configJson ?? "{}",
      authJson: body.authJson ?? "{}",
      enabled: body.enabled ?? true,
      pollIntervalSeconds: body.pollIntervalSeconds ?? 300
    });
    reply.code(201).send(connector);
  });

  app.patch("/api/v1/admin/connectors/:id", { preHandler: requireAdmin(store, config) }, async (request) => {
    const params = request.params as { id: string };
    const body = request.body as Partial<{
      type: "zabbix" | "prometheus" | "prtg" | "webhook";
      name: string;
      configJson: string;
      authJson: string;
      enabled: boolean;
      pollIntervalSeconds: number;
    }>;
    return store.updateConnector(params.id, body);
  });

  app.delete("/api/v1/admin/connectors/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const removed = await store.deleteConnector(params.id);
    if (!removed) {
      reply.code(404).send({ error: "Connector not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.post("/api/v1/admin/tabs", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as { tenantSlug?: string; title?: string; filterQuery?: string; isGlobal?: boolean };
    const tenants = await store.getTenants();
    const tenant = body.tenantSlug ? tenants.find((entry) => entry.slug === body.tenantSlug) : tenants[0];
    if (!tenant || !body.title) {
      reply.code(400).send({ error: "Tenant and title are required" });
      return;
    }

    const tab = await store.createTab(tenant.id, {
      title: body.title,
      slug: body.title.toLowerCase().replace(/\s+/g, "-"),
      sortOrder: (await store.getTabs(tenant.id)).length + 1,
      filterQuery: body.filterQuery ?? "",
      isGlobal: Boolean(body.isGlobal),
      enabled: true
    });
    reply.code(201).send(tab);
  });

  app.get("/api/v1/admin/banners", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getBanners(tenantId);
  });

  app.get("/api/v1/admin/incidents", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getIncidents(tenantId);
  });

  app.get("/api/v1/admin/maintenance", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getMaintenanceWindows(tenantId);
  });

  app.get("/api/v1/admin/subscriptions", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getSubscriptions(tenantId);
  });

  app.post("/api/v1/admin/banners", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as {
      tenantSlug?: string;
      scopeType?: Banner["scopeType"];
      scopeRef?: string;
      title?: string;
      message?: string;
      severity?: Banner["severity"];
    };
    const tenants = await store.getTenants();
    const tenant = body.tenantSlug ? tenants.find((entry) => entry.slug === body.tenantSlug) : tenants[0];
    if (!tenant || !body.title || !body.message || !body.scopeType) {
      reply.code(400).send({ error: "Tenant, scope, title, and message are required" });
      return;
    }

    const banner = await store.createBanner(tenant.id, {
      scopeType: body.scopeType,
      scopeRef: body.scopeRef ?? "",
      title: body.title,
      message: body.message,
      severity: body.severity ?? "degraded",
      startsAt: null,
      endsAt: null,
      active: true
    });
    reply.code(201).send(banner);
  });

  app.patch("/api/v1/admin/banners/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as Partial<Pick<Banner, "scopeType" | "scopeRef" | "title" | "message" | "severity" | "startsAt" | "endsAt" | "active">>;
    const updated = await store.updateBanner(params.id, body);
    if (!updated) {
      reply.code(404).send({ error: "Banner not found" });
      return;
    }
    reply.send(updated);
  });

  app.delete("/api/v1/admin/banners/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const removed = await store.deleteBanner(params.id);
    if (!removed) {
      reply.code(404).send({ error: "Banner not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.post("/api/v1/admin/subscriptions", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as {
      tenantSlug?: string;
      serviceId?: string | null;
      channelType?: "slack" | "email";
      target?: string;
      enabled?: boolean;
    };
    const tenants = await store.getTenants();
    const tenant = body.tenantSlug ? tenants.find((entry) => entry.slug === body.tenantSlug) : tenants[0];
    if (!tenant || !body.channelType || !body.target) {
      reply.code(400).send({ error: "Tenant, channel type, and target are required" });
      return;
    }
    const created = await store.createSubscription(tenant.id, {
      serviceId: body.serviceId ?? null,
      channelType: body.channelType,
      target: body.target,
      enabled: body.enabled ?? true
    });
    reply.code(201).send(created);
  });

  app.delete("/api/v1/admin/subscriptions/:id", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const removed = await store.deleteSubscription(params.id);
    if (!removed) {
      reply.code(404).send({ error: "Subscription not found" });
      return;
    }
    reply.send({ ok: true });
  });

  app.get("/api/v1/admin/branding", { preHandler: requireAdmin(store, config) }, async () => store.getBranding());

  app.put("/api/v1/admin/branding", { preHandler: requireAdmin(store, config) }, async (request) => {
    const body = request.body as { appName?: string; logoUrl?: string; faviconUrl?: string; themeDefault?: "light" | "dark" };
    const patch: Partial<{
      appName: string;
      logoUrl: string;
      faviconUrl: string;
      themeDefault: "light" | "dark";
    }> = {};

    if (body.appName !== undefined) {
      patch.appName = body.appName;
    }
    if (body.logoUrl !== undefined) {
      patch.logoUrl = body.logoUrl;
    }
    if (body.faviconUrl !== undefined) {
      patch.faviconUrl = body.faviconUrl;
    }
    if (body.themeDefault !== undefined) {
      patch.themeDefault = body.themeDefault;
    }

    return store.updateBranding(patch);
  });

  app.get("/api/v1/admin/colors", { preHandler: requireAdmin(store, config) }, async (request) => {
    const tenantSlug = parseTenantSlug(request.query as Record<string, unknown>);
    const tenants = await store.getTenants();
    const tenantId = tenantSlug ? tenants.find((tenant) => tenant.slug === tenantSlug)?.id : undefined;
    return store.getColors(tenantId);
  });

  app.put("/api/v1/admin/colors", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const body = request.body as {
      tenantSlug?: string;
      colors?: Array<{ statusKey: StatusLevel; colorHex: string; label: string }>;
    };
    const tenants = await store.getTenants();
    const tenant = body.tenantSlug ? tenants.find((entry) => entry.slug === body.tenantSlug) : tenants[0];
    if (!tenant || !body.colors) {
      reply.code(400).send({ error: "Tenant and colors are required" });
      return;
    }
    return store.updateColors(tenant.id, body.colors);
  });

  app.get("/api/v1/admin/bootstrap", { preHandler: requireAdmin(store, config) }, async () => ({
    adminCount: (await store.listUsers()).filter((user) => user.isAdmin).length,
    tenantCount: (await store.getTenants()).length,
    bannerCount: (await store.getBanners()).length,
    tabCount: (await store.getTabs()).length,
    connectorCount: (await store.getConnectors()).length
  }));

  app.get("/api/v1/admin/summary", { preHandler: requireAdmin(store, config) }, async () => ({
    tenants: await store.getTenants(),
    tabs: await store.getTabs(),
    services: await store.getServices(),
    connectors: await store.getConnectors(),
    banners: await store.getBanners(),
    colors: await store.getColors(),
    meta: await store.getMeta()
  }));

  app.get("/api/v1/admin/collection-health", { preHandler: requireAdmin(store, config) }, async () => {
    const tenants = await store.getTenants();
    return {
      generatedAt: nowIso(),
      tenants: await Promise.all(
        tenants.map(async (tenant) => {
          const [connectors, latestSnapshot] = await Promise.all([store.getConnectors(tenant.id), store.getLatestSnapshot(tenant.id)]);
          return {
            tenant,
            overallStatus: latestSnapshot?.overallStatus ?? (await store.computeOverallStatus(tenant.id)),
            latestSnapshotAt: latestSnapshot?.collectedAt ?? null,
            latestSnapshotAgeSeconds: latestSnapshot
              ? Math.max(0, Math.round((Date.now() - Date.parse(latestSnapshot.collectedAt)) / 1000))
              : null,
              connectors: connectors.map((connector) => ({
                id: connector.id,
                name: connector.name,
                type: connector.type,
                enabled: connector.enabled,
                pollIntervalSeconds: connector.pollIntervalSeconds,
                lastSuccessAt: connector.lastSuccessAt,
                lastErrorAt: connector.lastErrorAt,
                nextDueAt: connector.type === "webhook" ? null : computeNextDueAt(connector.lastSuccessAt, connector.lastErrorAt, connector.pollIntervalSeconds),
                isDue:
                  connector.type === "webhook"
                    ? false
                    : !connector.lastSuccessAt && !connector.lastErrorAt
                      ? true
                      : Date.now() -
                          Date.parse(connector.lastSuccessAt ?? connector.lastErrorAt ?? new Date(0).toISOString()) >=
                        connector.pollIntervalSeconds * 1000
              }))
            };
        })
      )
    };
  });

  app.post("/api/v1/admin/banners/:id/toggle", { preHandler: requireAdmin(store, config) }, async (request, reply) => {
    const params = request.params as { id: string };
    const updated = await store.toggleBanner(params.id);
    if (!updated) {
      reply.code(404).send({ error: "Banner not found" });
      return;
    }
    reply.send(updated);
  });

  app.get("/api/v1/dev/info", async () => {
    const runtimeConfig = await effectiveConfig();
    return {
      name: config.appName,
      cookieName: getCookieName(),
      statusAuthMode: runtimeConfig.publicAuthMode,
      tenantCount: (await store.getTenants()).length,
      serviceCount: (await store.getServices()).length,
      connectorCount: (await store.getConnectors()).length,
      bannerCount: (await store.getBanners()).length
    };
  });
}
