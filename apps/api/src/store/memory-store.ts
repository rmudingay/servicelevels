import type {
  AdminUser,
  AppMeta,
  Banner,
  Branding,
  ColorMapping,
  Incident,
  IntegrationConnector,
  ServiceDefinition,
  MaintenanceWindow,
  NotificationSubscription,
  PlatformSettings,
  ServiceDailySummary,
  Snapshot,
  StatusDailySummary,
  StatusLevel,
  StatusView,
  TabDefinition,
  Tenant
} from "@service-levels/shared";
import { createHash } from "node:crypto";
import { nowIso, slugify, worstStatus } from "../utils.js";
import { clonePlatformSettings, platformSettingsFromConfig } from "../settings.js";
import { mergeSummaryStatus, severityTrend, splitUtcIntervalByDay, utcDayKey } from "./utils.js";
import type { AppConfig } from "../config.js";

type InternalState = {
  meta: AppMeta;
  branding: Branding;
  tenants: Tenant[];
  tabs: TabDefinition[];
  services: ServiceDefinition[];
  connectors: IntegrationConnector[];
  banners: Banner[];
  incidents: Incident[];
  maintenance: MaintenanceWindow[];
  subscriptions: NotificationSubscription[];
  colors: ColorMapping[];
  snapshots: Snapshot[];
  dailySummaries: StatusDailySummary[];
  users: AdminUser[];
  passwordHashes: Record<string, string>;
  platformSettings: PlatformSettings;
};

function statusSummary(status: StatusLevel): string {
  switch (status) {
    case "healthy":
      return "Operating normally";
    case "degraded":
      return "Degraded service";
    case "down":
      return "Service unavailable";
    case "maintenance":
      return "Scheduled maintenance";
    default:
      return "Status unavailable";
  }
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function emptySecondsByStatus(): Record<StatusLevel, number> {
  return {
    healthy: 0,
    degraded: 0,
    down: 0,
    maintenance: 0,
    unknown: 0
  };
}

function cloneSecondsByStatus(seconds: Record<StatusLevel, number>): Record<StatusLevel, number> {
  return {
    healthy: seconds.healthy ?? 0,
    degraded: seconds.degraded ?? 0,
    down: seconds.down ?? 0,
    maintenance: seconds.maintenance ?? 0,
    unknown: seconds.unknown ?? 0
  };
}

function cloneSummary(summary: StatusDailySummary): StatusDailySummary {
  return {
    ...summary,
    secondsByStatus: cloneSecondsByStatus(summary.secondsByStatus),
    serviceSummaries: (summary.serviceSummaries ?? []).map((entry) => ({
      ...entry,
      secondsByStatus: cloneSecondsByStatus(entry.secondsByStatus)
    }))
  };
}

function createServiceDailySummary(
  tenantId: string,
  serviceId: string,
  day: string,
  observedAt: string,
  latestSummary = "Status unavailable"
): ServiceDailySummary {
  return {
    tenantId,
    serviceId,
    day,
    overallStatus: "unknown",
    secondsByStatus: emptySecondsByStatus(),
    firstCollectedAt: observedAt,
    lastCollectedAt: observedAt,
    sampleCount: 0,
    latestSummary
  };
}

function ensureServiceDailySummary(
  summary: StatusDailySummary,
  serviceId: string,
  observedAt: string,
  latestSummary = "Status unavailable"
): ServiceDailySummary {
  const existing = summary.serviceSummaries.find((entry) => entry.serviceId === serviceId);
  if (existing) {
    return existing;
  }
  const serviceSummary = createServiceDailySummary(summary.tenantId, serviceId, summary.day, observedAt, latestSummary);
  summary.serviceSummaries = [...summary.serviceSummaries, serviceSummary];
  return serviceSummary;
}

function defaultColorsForTenant(tenantId: string): ColorMapping[] {
  return [
    { tenantId, statusKey: "healthy", colorHex: "#3BB273", label: "Healthy" },
    { tenantId, statusKey: "degraded", colorHex: "#D9A441", label: "Degraded" },
    { tenantId, statusKey: "down", colorHex: "#D94B4B", label: "Down" },
    { tenantId, statusKey: "maintenance", colorHex: "#4A90E2", label: "Maintenance" },
    { tenantId, statusKey: "unknown", colorHex: "#7A7F87", label: "Unknown" }
  ];
}

function ensureDailySummary(state: InternalState, tenantId: string, day: string): StatusDailySummary {
  const existing = state.dailySummaries.find((entry) => entry.tenantId === tenantId && entry.day === day);
  if (existing) {
    return existing;
  }
  const summary: StatusDailySummary = {
    tenantId,
    day,
    overallStatus: "unknown",
    secondsByStatus: emptySecondsByStatus(),
    firstCollectedAt: `${day}T00:00:00.000Z`,
    lastCollectedAt: `${day}T00:00:00.000Z`,
    sampleCount: 0,
    serviceSummaries: []
  };
  state.dailySummaries = [...state.dailySummaries, summary];
  return summary;
}

function addDuration(summary: StatusDailySummary, status: StatusLevel, seconds: number, observedAt: string): void {
  summary.secondsByStatus[status] = (summary.secondsByStatus[status] ?? 0) + seconds;
  summary.overallStatus = mergeSummaryStatus(summary.overallStatus, status);
  summary.lastCollectedAt = summary.lastCollectedAt > observedAt ? summary.lastCollectedAt : observedAt;
}

function addObservation(summary: StatusDailySummary, status: StatusLevel, observedAt: string): void {
  summary.overallStatus = mergeSummaryStatus(summary.overallStatus, status);
  summary.sampleCount += 1;
  summary.firstCollectedAt = summary.sampleCount === 1 || observedAt < summary.firstCollectedAt ? observedAt : summary.firstCollectedAt;
  summary.lastCollectedAt = observedAt > summary.lastCollectedAt ? observedAt : summary.lastCollectedAt;
}

function addServiceDuration(
  summary: StatusDailySummary,
  service: Snapshot["services"][number],
  seconds: number,
  observedAt: string
): void {
  const serviceSummary = ensureServiceDailySummary(summary, service.serviceId, observedAt, service.summary);
  serviceSummary.secondsByStatus[service.status] = (serviceSummary.secondsByStatus[service.status] ?? 0) + seconds;
  serviceSummary.overallStatus = mergeSummaryStatus(serviceSummary.overallStatus, service.status);
  serviceSummary.latestSummary = service.summary;
  serviceSummary.lastCollectedAt = serviceSummary.lastCollectedAt > observedAt ? serviceSummary.lastCollectedAt : observedAt;
}

function addServiceObservation(summary: StatusDailySummary, service: Snapshot["services"][number], observedAt: string): void {
  const serviceSummary = ensureServiceDailySummary(summary, service.serviceId, observedAt, service.summary);
  serviceSummary.overallStatus = mergeSummaryStatus(serviceSummary.overallStatus, service.status);
  serviceSummary.latestSummary = service.summary;
  serviceSummary.sampleCount += 1;
  serviceSummary.firstCollectedAt = serviceSummary.sampleCount === 1 || observedAt < serviceSummary.firstCollectedAt ? observedAt : serviceSummary.firstCollectedAt;
  serviceSummary.lastCollectedAt = observedAt > serviceSummary.lastCollectedAt ? observedAt : serviceSummary.lastCollectedAt;
}

function seedState(config: AppConfig): InternalState {
  const tenant: Tenant = {
      id: "tenant-primary-site",
      slug: "primary-site",
      name: "Primary Site",
      description: "Primary logical location",
    enabled: true
  };

  const tabs: TabDefinition[] = [
    {
      id: "tab-global",
      tenantId: tenant.id,
      title: "Global",
      slug: "global",
      sortOrder: 1,
      filterQuery: "",
      isGlobal: true,
      enabled: true
    },
    {
      id: "tab-infra",
      tenantId: tenant.id,
      title: "Infrastructure",
      slug: "infrastructure",
      sortOrder: 2,
      filterQuery: "category:infrastructure",
      isGlobal: false,
      enabled: true
    }
  ];

  const services: ServiceDefinition[] = [
    {
      id: "svc-auth",
      tenantId: tenant.id,
      name: "Authentication",
      slug: "authentication",
      category: "platform",
      topic: "identity",
      tags: ["platform", "critical"],
      sourceType: "zabbix",
      sourceRef: "zabbix:auth",
      enabled: true
    },
    {
      id: "svc-prom",
      tenantId: tenant.id,
      name: "Metrics Pipeline",
      slug: "metrics-pipeline",
      category: "infrastructure",
      topic: "metrics",
      tags: ["metrics", "platform"],
      sourceType: "prometheus",
      sourceRef: "prometheus:metrics",
      enabled: true
    },
    {
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
    }
  ];

  const banners: Banner[] = [
    {
      id: "banner-maint",
      tenantId: tenant.id,
      scopeType: "category",
      scopeRef: "infrastructure",
      title: "Planned maintenance",
      message: "Some infrastructure services may report degraded status during the maintenance window.",
      severity: "maintenance",
      startsAt: null,
      endsAt: null,
      updatedAt: nowIso(),
      severityTrend: null,
      active: true
    }
  ];

  const incidents: Incident[] = [
    {
      id: "incident-1",
      tenantId: tenant.id,
      serviceId: "svc-prom",
      title: "Prometheus query latency elevated",
      description: "The metrics pipeline is slower than expected during the current load window.",
      status: "open",
      openedAt: nowIso(),
      resolvedAt: null,
      sourceType: "prometheus"
    }
  ];

  const maintenance: MaintenanceWindow[] = [
    {
      id: "maintenance-1",
      tenantId: tenant.id,
      serviceId: "svc-prtg",
      title: "PRTG maintenance window",
      description: "Network monitoring is in a planned maintenance interval.",
      startsAt: nowIso(),
      endsAt: null,
      status: "active",
      createdBy: "system"
    }
  ];

  const colors: ColorMapping[] = [
    { tenantId: tenant.id, statusKey: "healthy", colorHex: "#3BB273", label: "Healthy" },
    { tenantId: tenant.id, statusKey: "degraded", colorHex: "#D9A441", label: "Degraded" },
    { tenantId: tenant.id, statusKey: "down", colorHex: "#D94B4B", label: "Down" },
    { tenantId: tenant.id, statusKey: "maintenance", colorHex: "#4A90E2", label: "Maintenance" },
    { tenantId: tenant.id, statusKey: "unknown", colorHex: "#7A7F87", label: "Unknown" }
  ];

  const snapshot: Snapshot = {
    id: "snapshot-1",
    tenantId: tenant.id,
    collectedAt: nowIso(),
    overallStatus: "degraded",
    services: [
      {
        serviceId: "svc-auth",
        status: "healthy",
        summary: "Authentication service healthy",
        lastCheckedAt: nowIso()
      },
      {
        serviceId: "svc-prom",
        status: "degraded",
        summary: "Prometheus query latency elevated",
        lastCheckedAt: nowIso()
      },
      {
        serviceId: "svc-prtg",
        status: "maintenance",
        summary: "Monitoring maintenance in progress",
        lastCheckedAt: nowIso()
      }
    ],
    rawPayload: {
      seeded: true
    }
  };

  return {
    meta: {
      appName: config.appName,
      logoUrl: config.logoUrl,
      faviconUrl: config.faviconUrl,
      themeDefault: config.themeDefault,
      publicAuthMode: config.publicAuthMode,
      adminAuthModes: config.adminAuthModes
    },
    branding: {
      appName: config.appName,
      logoUrl: config.logoUrl,
      faviconUrl: config.faviconUrl,
      themeDefault: config.themeDefault
    },
    tenants: [tenant],
    tabs,
    services,
    connectors: [],
    banners,
    incidents,
    maintenance,
    subscriptions: [],
    colors,
    snapshots: [snapshot],
    dailySummaries: [
      {
        tenantId: tenant.id,
        day: utcDayKey(snapshot.collectedAt),
        overallStatus: snapshot.overallStatus,
        secondsByStatus: emptySecondsByStatus(),
        firstCollectedAt: snapshot.collectedAt,
        lastCollectedAt: snapshot.collectedAt,
        sampleCount: 1,
        serviceSummaries: snapshot.services.map((service) => ({
          tenantId: tenant.id,
          serviceId: service.serviceId,
          day: utcDayKey(snapshot.collectedAt),
          overallStatus: service.status,
          secondsByStatus: emptySecondsByStatus(),
          firstCollectedAt: snapshot.collectedAt,
          lastCollectedAt: snapshot.collectedAt,
          sampleCount: 1,
          latestSummary: service.summary
        }))
      }
    ],
    users: [
      {
        id: "user-admin",
        username: config.adminUsername,
        displayName: "Main Administrator",
        email: "admin@example.invalid",
        authType: "local",
        isAdmin: true,
        enabled: true
      }
    ],
    passwordHashes: {
      [config.adminUsername]: hashPassword(config.adminPassword)
    },
    platformSettings: platformSettingsFromConfig(config)
  };
}

export class MemoryStore {
  private state: InternalState;
  private adminPassword: string;

  constructor(config: AppConfig) {
    this.state = seedState(config);
    this.adminPassword = config.adminPassword;
  }

  async getMeta(): Promise<AppMeta> {
    return {
      ...this.state.meta,
      publicAuthMode: this.state.platformSettings.auth.publicAuthMode,
      adminAuthModes: this.state.platformSettings.auth.adminAuthModes
    };
  }

  async getBranding(): Promise<Branding> {
    return this.state.branding;
  }

  async getPlatformSettings(): Promise<PlatformSettings> {
    return clonePlatformSettings(this.state.platformSettings);
  }

  async getTenants(): Promise<Tenant[]> {
    return [...this.state.tenants];
  }

  async getTabs(tenantId?: string): Promise<TabDefinition[]> {
    return this.state.tabs.filter((tab) => !tenantId || tab.tenantId === tenantId);
  }

  async getServices(tenantId?: string): Promise<ServiceDefinition[]> {
    return this.state.services.filter((service) => !tenantId || service.tenantId === tenantId);
  }

  async getConnectors(tenantId?: string): Promise<IntegrationConnector[]> {
    return this.state.connectors.filter((connector) => !tenantId || connector.tenantId === tenantId);
  }

  async getBanners(tenantId?: string): Promise<Banner[]> {
    return this.state.banners.filter((banner) => !tenantId || banner.tenantId === tenantId);
  }

  async getIncidents(tenantId?: string): Promise<Incident[]> {
    return this.state.incidents.filter((incident) => !tenantId || incident.tenantId === tenantId);
  }

  async getMaintenanceWindows(tenantId?: string): Promise<MaintenanceWindow[]> {
    return this.state.maintenance.filter((entry) => !tenantId || entry.tenantId === tenantId);
  }

  async getSubscriptions(tenantId?: string): Promise<NotificationSubscription[]> {
    return this.state.subscriptions.filter((entry) => !tenantId || entry.tenantId === tenantId);
  }

  async getColors(tenantId?: string): Promise<ColorMapping[]> {
    return this.state.colors.filter((color) => !tenantId || color.tenantId === tenantId);
  }

  async getLatestSnapshot(tenantId?: string): Promise<Snapshot | null> {
    const snapshots = this.state.snapshots.filter((snapshot) => !tenantId || snapshot.tenantId === tenantId);
    return snapshots.at(-1) ?? null;
  }

  async getDailySummaries(tenantId?: string): Promise<StatusDailySummary[]> {
    return this.state.dailySummaries
      .filter((entry) => !tenantId || entry.tenantId === tenantId)
      .map(cloneSummary)
      .sort((left, right) => right.day.localeCompare(left.day));
  }

  async getStatusView(tenantSlug?: string): Promise<StatusView> {
    const tenant = tenantSlug
      ? this.state.tenants.find((entry) => entry.slug === tenantSlug) ?? this.state.tenants[0]
      : this.state.tenants[0];

    return {
      meta: await this.getMeta(),
      tenants: await this.getTenants(),
      tabs: await this.getTabs(tenant?.id),
      services: await this.getServices(tenant?.id),
      connectors: await this.getConnectors(tenant?.id),
      banners: await this.getBanners(tenant?.id),
      incidents: await this.getIncidents(tenant?.id),
      maintenance: await this.getMaintenanceWindows(tenant?.id),
      subscriptions: await this.getSubscriptions(tenant?.id),
      colors: await this.getColors(tenant?.id),
      snapshot: tenant ? await this.getLatestSnapshot(tenant.id) : null,
      dailySummaries: tenant ? await this.getDailySummaries(tenant.id) : []
    };
  }

  async listUsers(): Promise<AdminUser[]> {
    return [...this.state.users];
  }

  async findUserByUsername(username: string): Promise<AdminUser | undefined> {
    return this.state.users.find((user) => user.username === username);
  }

  async findUserById(id: string): Promise<AdminUser | undefined> {
    return this.state.users.find((user) => user.id === id);
  }

  async verifyLocalCredentials(username: string, password: string): Promise<AdminUser | null> {
    const user = this.state.users.find((entry) => entry.username === username && entry.authType === "local");
    if (!user) {
      return null;
    }
    if (this.state.passwordHashes[username] !== hashPassword(password)) {
      return null;
    }
    return user;
  }

  async createUser(input: Omit<AdminUser, "id"> & { password?: string | null }): Promise<AdminUser> {
    const user: AdminUser = {
      id: `user-${slugify(input.username)}-${Date.now()}`,
      username: input.username,
      displayName: input.displayName,
      email: input.email,
      authType: input.authType,
      isAdmin: input.isAdmin,
      enabled: input.enabled
    };
    this.state.users = [...this.state.users.filter((entry) => entry.username !== user.username), user];
    if (input.authType === "local" && input.password) {
      this.state.passwordHashes[user.username] = hashPassword(input.password);
    } else {
      delete this.state.passwordHashes[user.username];
    }
    return user;
  }

  async updateUser(userId: string, patch: Partial<AdminUser> & { password?: string | null }): Promise<AdminUser | null> {
    const index = this.state.users.findIndex((user) => user.id === userId);
    if (index < 0) {
      return null;
    }
    const current = this.state.users[index];
    const next = { ...current, ...patch };
    this.state.users[index] = next;
    if (typeof patch.password === "string") {
      this.state.passwordHashes[next.username] = hashPassword(patch.password);
    }
    if (patch.authType && patch.authType !== "local") {
      delete this.state.passwordHashes[next.username];
    }
    return next;
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<AdminUser | null> {
    return this.updateUser(userId, { isAdmin });
  }

  async upsertExternalUser(input: Pick<AdminUser, "username" | "displayName" | "email" | "authType"> & { enabled?: boolean; isAdmin?: boolean }): Promise<AdminUser> {
    const existing = this.state.users.find((user) => user.username === input.username);
    if (existing) {
      const next = { ...existing, displayName: input.displayName, email: input.email, authType: input.authType, enabled: input.enabled ?? existing.enabled };
      this.state.users = this.state.users.map((user) => (user.username === input.username ? next : user));
      return next;
    }
    return this.createUser({
      ...input,
      enabled: input.enabled ?? true,
      isAdmin: input.isAdmin ?? false,
      password: null
    });
  }

  async updatePlatformSettings(input: PlatformSettings): Promise<PlatformSettings> {
    this.state.platformSettings = clonePlatformSettings(input);
    this.state.meta = {
      ...this.state.meta,
      publicAuthMode: input.auth.publicAuthMode,
      adminAuthModes: [...input.auth.adminAuthModes]
    };
    return this.getPlatformSettings();
  }

  async updateBranding(input: Partial<Branding>): Promise<Branding> {
    this.state.branding = {
      ...this.state.branding,
      ...input
    };
    this.state.meta = {
      ...this.state.meta,
      appName: this.state.branding.appName,
      logoUrl: this.state.branding.logoUrl,
      faviconUrl: this.state.branding.faviconUrl,
      themeDefault: this.state.branding.themeDefault
    };
    return this.getBranding();
  }

  async updateColors(tenantId: string, updates: Array<{ statusKey: StatusLevel; colorHex: string; label: string }>): Promise<ColorMapping[]> {
    const existing = this.state.colors.filter((entry) => entry.tenantId !== tenantId);
    const mapped = updates.map((entry) => ({
      tenantId,
      statusKey: entry.statusKey,
      colorHex: entry.colorHex,
      label: entry.label
    }));
    this.state.colors = [...existing, ...mapped];
    return this.getColors(tenantId);
  }

  async createTenant(input: Omit<Tenant, "id">): Promise<Tenant> {
    const tenant: Tenant = {
      ...input,
      id: `tenant-${slugify(input.slug || input.name)}-${Date.now()}`
    };
    this.state.tenants = [...this.state.tenants, tenant];
    this.state.tabs = [
      ...this.state.tabs,
      {
        id: `tab-global-${tenant.slug}-${Date.now()}`,
        tenantId: tenant.id,
        title: "Global",
        slug: "global",
        sortOrder: 1,
        filterQuery: "",
        isGlobal: true,
        enabled: true
      }
    ];
    this.state.colors = [...this.state.colors, ...defaultColorsForTenant(tenant.id)];
    return tenant;
  }

  async updateTenant(tenantId: string, patch: Partial<Tenant>): Promise<Tenant | null> {
    const index = this.state.tenants.findIndex((tenant) => tenant.id === tenantId);
    if (index < 0) {
      return null;
    }
    const next = { ...this.state.tenants[index], ...patch, id: tenantId };
    this.state.tenants[index] = next;
    return next;
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const before = this.state.tenants.length;
    this.state.tenants = this.state.tenants.filter((tenant) => tenant.id !== tenantId);
    if (this.state.tenants.length === before) {
      return false;
    }
    this.state.tabs = this.state.tabs.filter((entry) => entry.tenantId !== tenantId);
    this.state.services = this.state.services.filter((entry) => entry.tenantId !== tenantId);
    this.state.connectors = this.state.connectors.filter((entry) => entry.tenantId !== tenantId);
    this.state.banners = this.state.banners.filter((entry) => entry.tenantId !== tenantId);
    this.state.incidents = this.state.incidents.filter((entry) => entry.tenantId !== tenantId);
    this.state.maintenance = this.state.maintenance.filter((entry) => entry.tenantId !== tenantId);
    this.state.subscriptions = this.state.subscriptions.filter((entry) => entry.tenantId !== tenantId);
    this.state.colors = this.state.colors.filter((entry) => entry.tenantId !== tenantId);
    this.state.snapshots = this.state.snapshots.filter((entry) => entry.tenantId !== tenantId);
    this.state.dailySummaries = this.state.dailySummaries.filter((entry) => entry.tenantId !== tenantId);
    return true;
  }

  async createService(tenantId: string, input: Omit<ServiceDefinition, "id" | "tenantId">): Promise<ServiceDefinition> {
    const service: ServiceDefinition = {
      ...input,
      id: `service-${slugify(input.slug || input.name)}-${Date.now()}`,
      tenantId,
      slug: slugify(input.slug || input.name)
    };
    this.state.services = [...this.state.services, service];
    return service;
  }

  async updateService(serviceId: string, patch: Partial<Omit<ServiceDefinition, "id" | "tenantId">>): Promise<ServiceDefinition | null> {
    const index = this.state.services.findIndex((service) => service.id === serviceId);
    if (index < 0) {
      return null;
    }
    const current = this.state.services[index];
    const next: ServiceDefinition = {
      ...current,
      ...patch,
      slug: patch.slug !== undefined ? slugify(patch.slug) : current.slug
    };
    this.state.services[index] = next;
    return next;
  }

  async deleteService(serviceId: string): Promise<boolean> {
    const before = this.state.services.length;
    this.state.services = this.state.services.filter((service) => service.id !== serviceId);
    if (this.state.services.length === before) {
      return false;
    }
    this.state.incidents = this.state.incidents.filter((entry) => entry.serviceId !== serviceId);
    this.state.maintenance = this.state.maintenance.filter((entry) => entry.serviceId !== serviceId);
    this.state.subscriptions = this.state.subscriptions.filter((entry) => entry.serviceId !== serviceId);
    this.state.dailySummaries = this.state.dailySummaries.map((summary) => ({
      ...summary,
      serviceSummaries: summary.serviceSummaries.filter((entry) => entry.serviceId !== serviceId)
    }));
    return true;
  }

  async createSubscription(tenantId: string, input: Omit<NotificationSubscription, "id" | "tenantId">): Promise<NotificationSubscription> {
    const subscription: NotificationSubscription = {
      ...input,
      id: `subscription-${slugify(input.channelType)}-${Date.now()}`,
      tenantId
    };
    this.state.subscriptions = [...this.state.subscriptions.filter((entry) => entry.id !== subscription.id), subscription];
    return subscription;
  }

  async deleteSubscription(subscriptionId: string): Promise<boolean> {
    const before = this.state.subscriptions.length;
    this.state.subscriptions = this.state.subscriptions.filter((entry) => entry.id !== subscriptionId);
    return this.state.subscriptions.length !== before;
  }

  async createConnector(
    tenantId: string,
    input: Omit<IntegrationConnector, "id" | "tenantId" | "lastSuccessAt" | "lastErrorAt" | "lastErrorMessage">
  ): Promise<IntegrationConnector> {
    const connector: IntegrationConnector = {
      ...input,
      id: `connector-${slugify(input.name)}-${Date.now()}`,
      tenantId,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null
    };
    this.state.connectors = [...this.state.connectors, connector];
    return connector;
  }

  async updateConnector(connectorId: string, patch: Partial<IntegrationConnector>): Promise<IntegrationConnector | null> {
    const index = this.state.connectors.findIndex((connector) => connector.id === connectorId);
    if (index < 0) {
      return null;
    }
    const current = this.state.connectors[index];
    const next = { ...current, ...patch };
    this.state.connectors[index] = next;
    return next;
  }

  async deleteConnector(connectorId: string): Promise<boolean> {
    const before = this.state.connectors.length;
    this.state.connectors = this.state.connectors.filter((connector) => connector.id !== connectorId);
    return this.state.connectors.length !== before;
  }

  async createBanner(
    tenantId: string,
    input: Omit<Banner, "id" | "tenantId" | "updatedAt" | "severityTrend"> & Partial<Pick<Banner, "updatedAt" | "severityTrend">>
  ): Promise<Banner> {
    const banner: Banner = {
      ...input,
      id: `banner-${slugify(input.title)}-${Date.now()}`,
      tenantId,
      updatedAt: input.updatedAt ?? nowIso(),
      severityTrend: input.severityTrend ?? null
    };
    this.state.banners = [...this.state.banners, banner];
    return banner;
  }

  async createIncident(tenantId: string, input: Omit<Incident, "id" | "tenantId">): Promise<Incident> {
    const incident: Incident = {
      ...input,
      id: `incident-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    this.state.incidents = [...this.state.incidents, incident];
    return incident;
  }

  async resolveIncident(incidentId: string, resolvedAt = nowIso()): Promise<Incident | null> {
    const index = this.state.incidents.findIndex((incident) => incident.id === incidentId);
    if (index < 0) {
      return null;
    }
    const next = { ...this.state.incidents[index], status: "resolved" as const, resolvedAt };
    this.state.incidents[index] = next;
    return next;
  }

  async createMaintenanceWindow(tenantId: string, input: Omit<MaintenanceWindow, "id" | "tenantId">): Promise<MaintenanceWindow> {
    const maintenance: MaintenanceWindow = {
      ...input,
      id: `maintenance-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    this.state.maintenance = [...this.state.maintenance, maintenance];
    return maintenance;
  }

  async resolveMaintenanceWindow(windowId: string, resolvedAt = nowIso()): Promise<MaintenanceWindow | null> {
    const index = this.state.maintenance.findIndex((entry) => entry.id === windowId);
    if (index < 0) {
      return null;
    }
    const next = { ...this.state.maintenance[index], status: "resolved" as const, endsAt: resolvedAt };
    this.state.maintenance[index] = next;
    return next;
  }

  async updateBanner(bannerId: string, patch: Partial<Banner>): Promise<Banner | null> {
    const index = this.state.banners.findIndex((banner) => banner.id === bannerId);
    if (index < 0) {
      return null;
    }
    const current = this.state.banners[index];
    const nextSeverity = patch.severity ?? current.severity;
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
      severityTrend: patch.severity ? severityTrend(current.severity, nextSeverity) : "unchanged"
    };
    this.state.banners[index] = next;
    return next;
  }

  async toggleBanner(bannerId: string): Promise<Banner | null> {
    const index = this.state.banners.findIndex((banner) => banner.id === bannerId);
    if (index < 0) {
      return null;
    }
    const current = this.state.banners[index];
    const next = { ...current, active: !current.active, updatedAt: nowIso(), severityTrend: "unchanged" as const };
    this.state.banners[index] = next;
    return next;
  }

  async deleteBanner(bannerId: string): Promise<boolean> {
    const before = this.state.banners.length;
    this.state.banners = this.state.banners.filter((banner) => banner.id !== bannerId);
    return this.state.banners.length !== before;
  }

  async createTab(tenantId: string, input: Omit<TabDefinition, "id" | "tenantId">): Promise<TabDefinition> {
    const tab: TabDefinition = {
      ...input,
      id: `tab-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    this.state.tabs = [...this.state.tabs, tab];
    return tab;
  }

  async updateTab(tabId: string, patch: Partial<Omit<TabDefinition, "id" | "tenantId">>): Promise<TabDefinition | null> {
    const index = this.state.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return null;
    }
    const next = { ...this.state.tabs[index], ...patch };
    this.state.tabs[index] = next;
    return next;
  }

  async deleteTab(tabId: string): Promise<boolean> {
    const before = this.state.tabs.length;
    this.state.tabs = this.state.tabs.filter((tab) => tab.id !== tabId);
    return this.state.tabs.length !== before;
  }

  async updateTabs(tabs: TabDefinition[]): Promise<TabDefinition[]> {
    this.state.tabs = tabs;
    return this.state.tabs;
  }

  async saveSnapshot(snapshot: Snapshot): Promise<Snapshot> {
    const previous = await this.getLatestSnapshot(snapshot.tenantId);
    this.state.snapshots = this.state.snapshots.filter((entry) => entry.tenantId !== snapshot.tenantId);
    this.state.snapshots = [...this.state.snapshots, snapshot];

    const summaries = new Map(
      this.state.dailySummaries
        .filter((entry) => entry.tenantId === snapshot.tenantId)
        .map((entry) => [entry.day, cloneSummary(entry)] as const)
    );

    const currentDay = utcDayKey(snapshot.collectedAt);
    const currentSummary: StatusDailySummary =
      summaries.get(currentDay) ?? {
        tenantId: snapshot.tenantId,
        day: currentDay,
        overallStatus: "unknown",
        secondsByStatus: emptySecondsByStatus(),
        firstCollectedAt: snapshot.collectedAt,
        lastCollectedAt: snapshot.collectedAt,
        sampleCount: 0,
        serviceSummaries: []
      };
    addObservation(currentSummary, snapshot.overallStatus, snapshot.collectedAt);
    for (const service of snapshot.services) {
      addServiceObservation(currentSummary, service, snapshot.collectedAt);
    }
    summaries.set(currentDay, currentSummary);

    if (previous) {
      for (const segment of splitUtcIntervalByDay(previous.collectedAt, snapshot.collectedAt)) {
        const summary: StatusDailySummary =
          summaries.get(segment.day) ?? {
            tenantId: snapshot.tenantId,
            day: segment.day,
            overallStatus: "unknown",
            secondsByStatus: emptySecondsByStatus(),
            firstCollectedAt: segment.segmentStart,
            lastCollectedAt: segment.segmentEnd,
            sampleCount: 0,
            serviceSummaries: []
          };
        addDuration(summary, previous.overallStatus, segment.seconds, segment.segmentEnd);
        for (const service of previous.services) {
          addServiceDuration(summary, service, segment.seconds, segment.segmentEnd);
        }
        summary.firstCollectedAt = summary.firstCollectedAt < segment.segmentStart ? summary.firstCollectedAt : segment.segmentStart;
        summary.lastCollectedAt = summary.lastCollectedAt > segment.segmentEnd ? summary.lastCollectedAt : segment.segmentEnd;
        summaries.set(segment.day, summary);
      }
    }

    this.state.dailySummaries = [
      ...this.state.dailySummaries.filter((entry) => entry.tenantId !== snapshot.tenantId),
      ...Array.from(summaries.values()).map(cloneSummary)
    ].sort((left, right) => left.tenantId.localeCompare(right.tenantId) || left.day.localeCompare(right.day));
    return snapshot;
  }

  async computeOverallStatus(tenantId: string): Promise<StatusLevel> {
    const snapshot = await this.getLatestSnapshot(tenantId);
    if (!snapshot) {
      return "unknown";
    }
    return worstStatus(snapshot.services.map((service) => service.status).concat(snapshot.overallStatus));
  }

  async getMaintenanceBanners(tenantId: string): Promise<Banner[]> {
    const banners = await this.getBanners(tenantId);
    return banners.filter((banner) => banner.active && banner.severity === "maintenance");
  }
}
