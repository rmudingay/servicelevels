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
  ServiceStatusEvent,
  Snapshot,
  StatusDailySummary,
  StatusLevel,
  TabDefinition,
  Tenant
} from "@service-levels/shared";
import type { AppConfig } from "../config.js";
import { platformSettingsFromConfig } from "../settings.js";
import { nowIso } from "../utils.js";
import { serviceStatusEventsFromSnapshot, utcDayKey } from "./utils.js";

export type SeedState = {
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
  serviceEvents: ServiceStatusEvent[];
  dailySummaries: StatusDailySummary[];
  users: AdminUser[];
  platformSettings: PlatformSettings;
};

export function buildSeedState(config: AppConfig): SeedState {
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

  const colors: ColorMapping[] = [
    { tenantId: tenant.id, statusKey: "healthy", colorHex: "#3BB273", label: "Healthy" },
    { tenantId: tenant.id, statusKey: "degraded", colorHex: "#D9A441", label: "Degraded" },
    { tenantId: tenant.id, statusKey: "down", colorHex: "#D94B4B", label: "Down" },
    { tenantId: tenant.id, statusKey: "maintenance", colorHex: "#4A90E2", label: "Maintenance" },
    { tenantId: tenant.id, statusKey: "unknown", colorHex: "#7A7F87", label: "Unknown" }
  ];

  const connectors: IntegrationConnector[] = [
    {
      id: "connector-prometheus-demo",
      tenantId: tenant.id,
      type: "prometheus",
      name: "Prometheus Demo",
      configJson: JSON.stringify(
        {
          defaultStatus: "degraded",
          serviceStatuses: {
            "metrics-pipeline": "degraded"
          },
          summary: "Prometheus snapshot indicates elevated query latency"
        },
        null,
        2
      ),
      authJson: JSON.stringify({ kind: "demo" }, null, 2),
      enabled: true,
      pollIntervalSeconds: 300,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null
    },
    {
      id: "connector-zabbix-demo",
      tenantId: tenant.id,
      type: "zabbix",
      name: "Zabbix Demo",
      configJson: JSON.stringify(
        {
          defaultStatus: "healthy",
          serviceStatuses: {
            authentication: "healthy"
          },
          summary: "Zabbix snapshot collected successfully"
        },
        null,
        2
      ),
      authJson: JSON.stringify({ kind: "demo" }, null, 2),
      enabled: true,
      pollIntervalSeconds: 300,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null
    },
    {
      id: "connector-prtg-demo",
      tenantId: tenant.id,
      type: "prtg",
      name: "PRTG Demo",
      configJson: JSON.stringify(
        {
          defaultStatus: "maintenance",
          serviceStatuses: {
            "network-monitor": "maintenance"
          },
          summary: "PRTG maintenance window in effect"
        },
        null,
        2
      ),
      authJson: JSON.stringify({ kind: "demo" }, null, 2),
      enabled: true,
      pollIntervalSeconds: 300,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null
    }
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

  const dailySummary: StatusDailySummary = {
    tenantId: tenant.id,
    day: utcDayKey(snapshot.collectedAt),
    overallStatus: snapshot.overallStatus,
    secondsByStatus: {
      healthy: 0,
      degraded: 0,
      down: 0,
      maintenance: 0,
      unknown: 0
    },
    firstCollectedAt: snapshot.collectedAt,
    lastCollectedAt: snapshot.collectedAt,
    sampleCount: 1,
    serviceSummaries: snapshot.services.map((service) => ({
      tenantId: tenant.id,
      serviceId: service.serviceId,
      day: utcDayKey(snapshot.collectedAt),
      overallStatus: service.status,
      secondsByStatus: {
        healthy: 0,
        degraded: 0,
        down: 0,
        maintenance: 0,
        unknown: 0
      },
      firstCollectedAt: snapshot.collectedAt,
      lastCollectedAt: snapshot.collectedAt,
      sampleCount: 1,
      latestSummary: service.summary
    }))
  };

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
    connectors,
    banners,
    incidents,
    maintenance,
    subscriptions: [],
    colors,
    snapshots: [snapshot],
    serviceEvents: serviceStatusEventsFromSnapshot(snapshot, services),
    dailySummaries: [dailySummary],
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
    platformSettings: platformSettingsFromConfig(config)
  };
}
