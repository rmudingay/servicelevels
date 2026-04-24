import { createHash } from "node:crypto";
import { Pool } from "pg";
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
import type { AppConfig } from "../config.js";
import { clonePlatformSettings, normalizePlatformSettings, platformSettingsFromConfig } from "../settings.js";
import { nowIso, slugify } from "../utils.js";
import { buildSeedState, type SeedState } from "./seed.js";
import { runMigrations } from "./migrations.js";
import { mergeSummaryStatus, severityTrend, splitUtcIntervalByDay, utcDayKey, worstStatus } from "./utils.js";
import type { StatusRepository } from "./types.js";

type RawRow = Record<string, unknown>;

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

function jsonText(value: unknown, fallback = "{}"): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === 1 || value === "1";
}

function mapTenant(row: RawRow): Tenant {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description ?? ""),
    enabled: toBoolean(row.enabled)
  };
}

function mapTab(row: RawRow): TabDefinition {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    title: String(row.title),
    slug: String(row.slug),
    sortOrder: Number(row.sort_order ?? 0),
    filterQuery: String(row.filter_query ?? ""),
    isGlobal: toBoolean(row.is_global),
    enabled: toBoolean(row.enabled)
  };
}

function mapService(row: RawRow): ServiceDefinition {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    slug: String(row.slug),
    category: String(row.category ?? ""),
    topic: String(row.topic ?? ""),
    tags: parseJson<string[]>(row.tags, []),
    sourceType: String(row.source_type) as ServiceDefinition["sourceType"],
    sourceRef: String(row.source_ref ?? ""),
    enabled: toBoolean(row.enabled)
  };
}

function mapConnector(row: RawRow): IntegrationConnector {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    type: String(row.type) as IntegrationConnector["type"],
    name: String(row.name),
    configJson: jsonText(row.config_json),
    authJson: jsonText(row.auth_json),
    enabled: toBoolean(row.enabled),
    pollIntervalSeconds: Number(row.poll_interval_seconds ?? 300),
    lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : null,
    lastErrorAt: row.last_error_at ? new Date(String(row.last_error_at)).toISOString() : null,
    lastErrorMessage: typeof row.last_error_message === "string" && row.last_error_message ? row.last_error_message : null
  };
}

function mapBanner(row: RawRow): Banner {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    scopeType: String(row.scope_type) as Banner["scopeType"],
    scopeRef: String(row.scope_ref ?? ""),
    title: String(row.title),
    message: String(row.message),
    severity: String(row.severity) as Banner["severity"],
    startsAt: row.starts_at ? new Date(String(row.starts_at)).toISOString() : null,
    endsAt: row.ends_at ? new Date(String(row.ends_at)).toISOString() : null,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    severityTrend: row.severity_trend ? (String(row.severity_trend) as Banner["severityTrend"]) : null,
    active: toBoolean(row.active)
  };
}

function mapIncident(row: RawRow): Incident {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    serviceId: String(row.service_id),
    title: String(row.title),
    description: String(row.description),
    status: String(row.status) as Incident["status"],
    openedAt: new Date(String(row.opened_at)).toISOString(),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
    sourceType: String(row.source_type) as Incident["sourceType"]
  };
}

function mapMaintenance(row: RawRow): MaintenanceWindow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    serviceId: String(row.service_id),
    title: String(row.title),
    description: String(row.description),
    startsAt: new Date(String(row.starts_at)).toISOString(),
    endsAt: row.ends_at ? new Date(String(row.ends_at)).toISOString() : null,
    status: String(row.status) as MaintenanceWindow["status"],
    createdBy: String(row.created_by ?? "system")
  };
}

function mapSubscription(row: RawRow): NotificationSubscription {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    serviceId: row.service_id ? String(row.service_id) : null,
    channelType: String(row.channel_type) as NotificationSubscription["channelType"],
    target: String(row.target),
    enabled: toBoolean(row.enabled)
  };
}

function mapColor(row: RawRow): ColorMapping {
  return {
    tenantId: String(row.tenant_id),
    statusKey: String(row.status_key) as StatusLevel,
    colorHex: String(row.color_hex),
    label: String(row.label)
  };
}

function mapUser(row: RawRow): AdminUser {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name ?? ""),
    email: String(row.email ?? ""),
    authType: String(row.auth_type) as AdminUser["authType"],
    isAdmin: toBoolean(row.is_admin),
    enabled: toBoolean(row.enabled)
  };
}

function mapSnapshot(row: RawRow): Snapshot {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    collectedAt: new Date(String(row.collected_at)).toISOString(),
    overallStatus: String(row.overall_status) as StatusLevel,
    services: parseJson<Snapshot["services"]>(row.services, []),
    rawPayload: parseJson(row.raw_payload, {})
  };
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

function normalizeServiceDailySummaries(value: unknown): ServiceDailySummary[] {
  return parseJson<ServiceDailySummary[]>(value, []).map((entry) => ({
    tenantId: entry.tenantId,
    serviceId: entry.serviceId,
    day: entry.day,
    overallStatus: entry.overallStatus,
    secondsByStatus: cloneSecondsByStatus(entry.secondsByStatus),
    firstCollectedAt: new Date(entry.firstCollectedAt).toISOString(),
    lastCollectedAt: new Date(entry.lastCollectedAt).toISOString(),
    sampleCount: Number(entry.sampleCount ?? 0),
    latestSummary: entry.latestSummary ?? ""
  }));
}

function cloneDailySummary(summary: StatusDailySummary): StatusDailySummary {
  return {
    ...summary,
    secondsByStatus: cloneSecondsByStatus(summary.secondsByStatus),
    serviceSummaries: (summary.serviceSummaries ?? []).map((entry) => ({
      ...entry,
      secondsByStatus: cloneSecondsByStatus(entry.secondsByStatus)
    }))
  };
}

function mapDailySummary(row: RawRow): StatusDailySummary {
  return {
    tenantId: String(row.tenant_id),
    day: String(row.day),
    overallStatus: String(row.overall_status) as StatusLevel,
    secondsByStatus: cloneSecondsByStatus(parseJson<Record<StatusLevel, number>>(row.seconds_by_status, emptySecondsByStatus())),
    firstCollectedAt: new Date(String(row.first_collected_at)).toISOString(),
    lastCollectedAt: new Date(String(row.last_collected_at)).toISOString(),
    sampleCount: Number(row.sample_count ?? 0),
    serviceSummaries: normalizeServiceDailySummaries(row.service_summaries)
  };
}

function createEmptyDailySummary(tenantId: string, day: string, observedAt: string): StatusDailySummary {
  return {
    tenantId,
    day,
    overallStatus: "unknown",
    secondsByStatus: emptySecondsByStatus(),
    firstCollectedAt: observedAt,
    lastCollectedAt: observedAt,
    sampleCount: 0,
    serviceSummaries: []
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

function addObservation(summary: StatusDailySummary, status: StatusLevel, observedAt: string): void {
  summary.overallStatus = mergeSummaryStatus(summary.overallStatus, status);
  summary.sampleCount += 1;
  summary.firstCollectedAt = observedAt < summary.firstCollectedAt ? observedAt : summary.firstCollectedAt;
  summary.lastCollectedAt = observedAt > summary.lastCollectedAt ? observedAt : summary.lastCollectedAt;
}

function addDuration(summary: StatusDailySummary, status: StatusLevel, seconds: number, observedAt: string): void {
  summary.secondsByStatus[status] = (summary.secondsByStatus[status] ?? 0) + seconds;
  summary.overallStatus = mergeSummaryStatus(summary.overallStatus, status);
  summary.lastCollectedAt = observedAt > summary.lastCollectedAt ? observedAt : summary.lastCollectedAt;
}

function addServiceObservation(summary: StatusDailySummary, service: Snapshot["services"][number], observedAt: string): void {
  const serviceSummary = ensureServiceDailySummary(summary, service.serviceId, observedAt, service.summary);
  serviceSummary.overallStatus = mergeSummaryStatus(serviceSummary.overallStatus, service.status);
  serviceSummary.latestSummary = service.summary;
  serviceSummary.sampleCount += 1;
  serviceSummary.firstCollectedAt = serviceSummary.sampleCount === 1 || observedAt < serviceSummary.firstCollectedAt ? observedAt : serviceSummary.firstCollectedAt;
  serviceSummary.lastCollectedAt = observedAt > serviceSummary.lastCollectedAt ? observedAt : serviceSummary.lastCollectedAt;
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

function buildUpdatedDailySummaries(previous: Snapshot | null, current: Snapshot, existing: StatusDailySummary[]): StatusDailySummary[] {
  const summaries = new Map<string, StatusDailySummary>(
    existing.map((entry) => [entry.day, cloneDailySummary(entry)])
  );
  const currentDay = utcDayKey(current.collectedAt);
  const currentSummary = summaries.get(currentDay) ?? createEmptyDailySummary(current.tenantId, currentDay, current.collectedAt);
  addObservation(currentSummary, current.overallStatus, current.collectedAt);
  for (const service of current.services) {
    addServiceObservation(currentSummary, service, current.collectedAt);
  }
  summaries.set(currentDay, currentSummary);

  if (previous) {
    for (const segment of splitUtcIntervalByDay(previous.collectedAt, current.collectedAt)) {
      const summary = summaries.get(segment.day) ?? createEmptyDailySummary(current.tenantId, segment.day, segment.segmentStart);
      addDuration(summary, previous.overallStatus, segment.seconds, segment.segmentEnd);
      for (const service of previous.services) {
        addServiceDuration(summary, service, segment.seconds, segment.segmentEnd);
      }
      summary.firstCollectedAt = segment.segmentStart < summary.firstCollectedAt ? segment.segmentStart : summary.firstCollectedAt;
      summary.lastCollectedAt = segment.segmentEnd > summary.lastCollectedAt ? segment.segmentEnd : summary.lastCollectedAt;
      summaries.set(segment.day, summary);
    }
  }

  return Array.from(summaries.values()).sort((left, right) => left.day.localeCompare(right.day));
}

export class PostgresStore implements StatusRepository {
  private pool: Pool;
  private state: SeedState | null = null;

  constructor(private readonly config: AppConfig, databaseUrl: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await runMigrations(this.pool);
    await this.normalizeLegacySnapshotData();
    await this.seedIfEmpty();
    await this.loadState();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getMeta(): Promise<AppMeta> {
    const state = await this.freshState();
    return {
      ...state.meta,
      publicAuthMode: state.platformSettings.auth.publicAuthMode,
      adminAuthModes: state.platformSettings.auth.adminAuthModes
    };
  }

  async getBranding(): Promise<Branding> {
    const state = await this.freshState();
    return state.branding;
  }

  async getPlatformSettings(): Promise<PlatformSettings> {
    const state = await this.freshState();
    return clonePlatformSettings(state.platformSettings);
  }

  async getTenants(): Promise<Tenant[]> {
    const state = await this.freshState();
    return [...state.tenants];
  }

  async getTabs(tenantId?: string): Promise<TabDefinition[]> {
    const state = await this.freshState();
    return state.tabs.filter((tab) => !tenantId || tab.tenantId === tenantId);
  }

  async getServices(tenantId?: string): Promise<ServiceDefinition[]> {
    const state = await this.freshState();
    return state.services.filter((service) => !tenantId || service.tenantId === tenantId);
  }

  async getConnectors(tenantId?: string): Promise<IntegrationConnector[]> {
    const state = await this.freshState();
    return state.connectors.filter((connector) => !tenantId || connector.tenantId === tenantId);
  }

  async getBanners(tenantId?: string): Promise<Banner[]> {
    const state = await this.freshState();
    return state.banners.filter((banner) => !tenantId || banner.tenantId === tenantId);
  }

  async getIncidents(tenantId?: string): Promise<Incident[]> {
    const state = await this.freshState();
    return state.incidents.filter((incident) => !tenantId || incident.tenantId === tenantId);
  }

  async getMaintenanceWindows(tenantId?: string): Promise<MaintenanceWindow[]> {
    const state = await this.freshState();
    return state.maintenance.filter((entry) => !tenantId || entry.tenantId === tenantId);
  }

  async getSubscriptions(tenantId?: string): Promise<NotificationSubscription[]> {
    const state = await this.freshState();
    return state.subscriptions.filter((entry) => !tenantId || entry.tenantId === tenantId);
  }

  async getColors(tenantId?: string): Promise<ColorMapping[]> {
    const state = await this.freshState();
    return state.colors.filter((color) => !tenantId || color.tenantId === tenantId);
  }

  async getLatestSnapshot(tenantId?: string): Promise<Snapshot | null> {
    const state = await this.freshState();
    const snapshots = state.snapshots.filter((snapshot) => !tenantId || snapshot.tenantId === tenantId);
    return snapshots.at(-1) ?? null;
  }

  async getDailySummaries(tenantId?: string): Promise<StatusDailySummary[]> {
    const state = await this.freshState();
    return state.dailySummaries
      .filter((entry) => !tenantId || entry.tenantId === tenantId)
      .map(cloneDailySummary)
      .sort((left, right) => right.day.localeCompare(left.day));
  }

  async getStatusView(tenantSlug?: string): Promise<StatusView> {
    const state = await this.freshState();
    const tenant = tenantSlug
      ? state.tenants.find((entry) => entry.slug === tenantSlug) ?? state.tenants[0]
      : state.tenants[0];

    return {
      meta: {
        ...state.meta,
        publicAuthMode: state.platformSettings.auth.publicAuthMode,
        adminAuthModes: state.platformSettings.auth.adminAuthModes
      },
      tenants: [...state.tenants],
      tabs: state.tabs.filter((tab) => !tenant || tab.tenantId === tenant.id),
      services: state.services.filter((service) => !tenant || service.tenantId === tenant.id),
      connectors: state.connectors.filter((connector) => !tenant || connector.tenantId === tenant.id),
      banners: state.banners.filter((banner) => !tenant || banner.tenantId === tenant.id),
      incidents: state.incidents.filter((incident) => !tenant || incident.tenantId === tenant.id),
      maintenance: state.maintenance.filter((entry) => !tenant || entry.tenantId === tenant.id),
      subscriptions: state.subscriptions.filter((entry) => !tenant || entry.tenantId === tenant.id),
      colors: state.colors.filter((color) => !tenant || color.tenantId === tenant.id),
      snapshot: tenant ? state.snapshots.filter((snapshot) => snapshot.tenantId === tenant.id).at(-1) ?? null : null,
      dailySummaries: tenant
        ? state.dailySummaries
            .filter((entry) => entry.tenantId === tenant.id)
            .map(cloneDailySummary)
            .sort((left, right) => right.day.localeCompare(left.day))
        : []
    };
  }

  async listUsers(): Promise<AdminUser[]> {
    const state = await this.freshState();
    return [...state.users];
  }

  async findUserByUsername(username: string): Promise<AdminUser | undefined> {
    const state = await this.freshState();
    return state.users.find((user) => user.username === username);
  }

  async findUserById(id: string): Promise<AdminUser | undefined> {
    const state = await this.freshState();
    return state.users.find((user) => user.id === id);
  }

  async verifyLocalCredentials(username: string, password: string): Promise<AdminUser | null> {
    const result = await this.pool.query("SELECT * FROM users WHERE username = $1 AND auth_type = 'local' LIMIT 1", [username]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (String(row.password_hash ?? "") !== hashPassword(password)) {
      return null;
    }
    return mapUser(row);
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
    await this.pool.query(
      "INSERT INTO users (id, username, display_name, email, auth_type, is_admin, enabled, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [user.id, user.username, user.displayName, user.email, user.authType, user.isAdmin, user.enabled, input.authType === "local" && input.password ? hashPassword(input.password) : ""]
    );
    await this.loadState();
    return user;
  }

  async updateUser(userId: string, patch: Partial<AdminUser> & { password?: string | null }): Promise<AdminUser | null> {
    this.ensureState();
    const current = this.state!.users.find((user) => user.id === userId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    const currentRow = await this.pool.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
    if (!currentRow.rows[0]) {
      return null;
    }
    const passwordHash = typeof patch.password === "string" ? hashPassword(patch.password) : currentRow.rows[0].password_hash ?? "";
    await this.pool.query(
      "UPDATE users SET username = $1, display_name = $2, email = $3, auth_type = $4, is_admin = $5, enabled = $6, password_hash = $7 WHERE id = $8",
      [next.username, next.displayName, next.email, next.authType, next.isAdmin, next.enabled, patch.authType && patch.authType !== "local" ? "" : passwordHash, userId]
    );
    await this.loadState();
    return next;
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<AdminUser | null> {
    return this.updateUser(userId, { isAdmin });
  }

  async upsertExternalUser(
    input: Pick<AdminUser, "username" | "displayName" | "email" | "authType"> & { enabled?: boolean; isAdmin?: boolean }
  ): Promise<AdminUser> {
    const existing = await this.pool.query("SELECT * FROM users WHERE username = $1 LIMIT 1", [input.username]);
    const current = existing.rows[0];
    if (current) {
      const mapped = mapUser(current);
      if (mapped.authType === "local" && input.authType !== "local") {
        return mapped;
      }
      await this.pool.query(
        "UPDATE users SET display_name = $1, email = $2, auth_type = $3, enabled = $4 WHERE id = $5",
        [input.displayName, input.email, input.authType, input.enabled ?? mapped.enabled, mapped.id]
      );
      await this.loadState();
      return (await this.findUserById(mapped.id)) ?? mapped;
    }

    return this.createUser({
      username: input.username,
      displayName: input.displayName,
      email: input.email,
      authType: input.authType,
      isAdmin: input.isAdmin ?? false,
      enabled: input.enabled ?? true,
      password: null
    });
  }

  async updatePlatformSettings(input: PlatformSettings): Promise<PlatformSettings> {
    this.ensureState();
    const normalized = normalizePlatformSettings(input, platformSettingsFromConfig(this.config));
    await this.pool.query(
      "UPDATE app_settings SET auth_settings_json = $1::jsonb, notification_settings_json = $2::jsonb WHERE id = 1",
      [JSON.stringify(normalized.auth), JSON.stringify(normalized.notifications)]
    );
    this.state!.platformSettings = clonePlatformSettings(normalized);
    this.state!.meta = {
      ...this.state!.meta,
      publicAuthMode: normalized.auth.publicAuthMode,
      adminAuthModes: [...normalized.auth.adminAuthModes]
    };
    return this.getPlatformSettings();
  }

  async updateBranding(input: Partial<Branding>): Promise<Branding> {
    this.ensureState();
    const current = this.state!.branding;
    const next = { ...current, ...input };
    await this.pool.query(
      "UPDATE app_settings SET app_name = $1, logo_url = $2, favicon_url = $3, theme_default = $4 WHERE id = 1",
      [next.appName, next.logoUrl, next.faviconUrl, next.themeDefault]
    );
    this.state!.branding = next;
    this.state!.meta = {
      ...this.state!.meta,
      appName: next.appName,
      logoUrl: next.logoUrl,
      faviconUrl: next.faviconUrl,
      themeDefault: next.themeDefault
    };
    return next;
  }

  async updateColors(tenantId: string, updates: Array<{ statusKey: StatusLevel; colorHex: string; label: string }>): Promise<ColorMapping[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM colors WHERE tenant_id = $1", [tenantId]);
      for (const entry of updates) {
        await client.query(
          "INSERT INTO colors (tenant_id, status_key, color_hex, label) VALUES ($1,$2,$3,$4)",
          [tenantId, entry.statusKey, entry.colorHex, entry.label]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.loadState();
    return this.getColors(tenantId);
  }

  async createTenant(input: Omit<Tenant, "id">): Promise<Tenant> {
    const tenant: Tenant = {
      ...input,
      id: `tenant-${slugify(input.slug || input.name)}-${Date.now()}`
    };
    const tab: TabDefinition = {
      id: `tab-global-${tenant.slug}-${Date.now()}`,
      tenantId: tenant.id,
      title: "Global",
      slug: "global",
      sortOrder: 1,
      filterQuery: "",
      isGlobal: true,
      enabled: true
    };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO tenants (id, slug, name, description, enabled) VALUES ($1,$2,$3,$4,$5)", [
        tenant.id,
        tenant.slug,
        tenant.name,
        tenant.description,
        tenant.enabled
      ]);
      await client.query(
        "INSERT INTO tabs (id, tenant_id, title, slug, sort_order, filter_query, is_global, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [tab.id, tenant.id, tab.title, tab.slug, tab.sortOrder, tab.filterQuery, tab.isGlobal, tab.enabled]
      );
      for (const color of defaultColorsForTenant(tenant.id)) {
        await client.query("INSERT INTO colors (tenant_id, status_key, color_hex, label) VALUES ($1,$2,$3,$4)", [
          color.tenantId,
          color.statusKey,
          color.colorHex,
          color.label
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.loadState();
    return tenant;
  }

  async updateTenant(tenantId: string, patch: Partial<Tenant>): Promise<Tenant | null> {
    this.ensureState();
    const current = this.state!.tenants.find((tenant) => tenant.id === tenantId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch, id: tenantId };
    const result = await this.pool.query("UPDATE tenants SET slug = $1, name = $2, description = $3, enabled = $4 WHERE id = $5 RETURNING *", [
      next.slug,
      next.name,
      next.description,
      next.enabled,
      tenantId
    ]);
    await this.loadState();
    return result.rows[0] ? mapTenant(result.rows[0]) : null;
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
  }

  async createService(tenantId: string, input: Omit<ServiceDefinition, "id" | "tenantId">): Promise<ServiceDefinition> {
    const service: ServiceDefinition = {
      ...input,
      id: `service-${slugify(input.slug || input.name)}-${Date.now()}`,
      tenantId,
      slug: slugify(input.slug || input.name)
    };
    await this.pool.query(
      "INSERT INTO services (id, tenant_id, name, slug, category, topic, tags, source_type, source_ref, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
      [
        service.id,
        tenantId,
        service.name,
        service.slug,
        service.category,
        service.topic,
        JSON.stringify(service.tags),
        service.sourceType,
        service.sourceRef,
        service.enabled
      ]
    );
    await this.loadState();
    return service;
  }

  async updateService(serviceId: string, patch: Partial<Omit<ServiceDefinition, "id" | "tenantId">>): Promise<ServiceDefinition | null> {
    this.ensureState();
    const current = this.state!.services.find((service) => service.id === serviceId);
    if (!current) {
      return null;
    }
    const next: ServiceDefinition = {
      ...current,
      ...patch,
      slug: patch.slug !== undefined ? slugify(patch.slug) : current.slug
    };
    const result = await this.pool.query(
      "UPDATE services SET name = $1, slug = $2, category = $3, topic = $4, tags = $5::jsonb, source_type = $6, source_ref = $7, enabled = $8 WHERE id = $9 RETURNING *",
      [
        next.name,
        next.slug,
        next.category,
        next.topic,
        JSON.stringify(next.tags),
        next.sourceType,
        next.sourceRef,
        next.enabled,
        serviceId
      ]
    );
    await this.loadState();
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async deleteService(serviceId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM services WHERE id = $1", [serviceId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
  }

  async createSubscription(tenantId: string, input: Omit<NotificationSubscription, "id" | "tenantId">): Promise<NotificationSubscription> {
    const subscription: NotificationSubscription = {
      ...input,
      id: `subscription-${slugify(input.channelType)}-${Date.now()}`,
      tenantId
    };
    await this.pool.query(
      "INSERT INTO subscriptions (id, tenant_id, service_id, channel_type, target, enabled) VALUES ($1,$2,$3,$4,$5,$6)",
      [subscription.id, tenantId, subscription.serviceId, subscription.channelType, subscription.target, subscription.enabled]
    );
    await this.loadState();
    return subscription;
  }

  async deleteSubscription(subscriptionId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM subscriptions WHERE id = $1", [subscriptionId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
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
    await this.pool.query(
      "INSERT INTO connectors (id, tenant_id, type, name, config_json, auth_json, enabled, poll_interval_seconds, last_success_at, last_error_at, last_error_message) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)",
      [
        connector.id,
        tenantId,
        connector.type,
        connector.name,
        connector.configJson,
        connector.authJson,
        connector.enabled,
        connector.pollIntervalSeconds,
        connector.lastSuccessAt,
        connector.lastErrorAt,
        connector.lastErrorMessage
      ]
    );
    await this.loadState();
    return connector;
  }

  async updateConnector(connectorId: string, patch: Partial<IntegrationConnector>): Promise<IntegrationConnector | null> {
    this.ensureState();
    const current = this.state!.connectors.find((connector) => connector.id === connectorId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    await this.pool.query(
      "UPDATE connectors SET type = $1, name = $2, config_json = $3::jsonb, auth_json = $4::jsonb, enabled = $5, poll_interval_seconds = $6, last_success_at = $7, last_error_at = $8, last_error_message = $9 WHERE id = $10",
      [
        next.type,
        next.name,
        jsonText(next.configJson),
        jsonText(next.authJson),
        next.enabled,
        next.pollIntervalSeconds,
        next.lastSuccessAt,
        next.lastErrorAt,
        next.lastErrorMessage,
        connectorId
      ]
    );
    await this.loadState();
    return next;
  }

  async deleteConnector(connectorId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM connectors WHERE id = $1", [connectorId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
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
    await this.pool.query(
      "INSERT INTO banners (id, tenant_id, scope_type, scope_ref, title, message, severity, starts_at, ends_at, updated_at, severity_trend, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        banner.id,
        tenantId,
        banner.scopeType,
        banner.scopeRef,
        banner.title,
        banner.message,
        banner.severity,
        banner.startsAt,
        banner.endsAt,
        banner.updatedAt,
        banner.severityTrend,
        banner.active
      ]
    );
    await this.loadState();
    return banner;
  }

  async createIncident(tenantId: string, input: Omit<Incident, "id" | "tenantId">): Promise<Incident> {
    const incident: Incident = {
      ...input,
      id: `incident-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    await this.pool.query(
      "INSERT INTO incidents (id, tenant_id, service_id, title, description, status, opened_at, resolved_at, source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [incident.id, tenantId, incident.serviceId, incident.title, incident.description, incident.status, incident.openedAt, incident.resolvedAt, incident.sourceType]
    );
    await this.loadState();
    return incident;
  }

  async resolveIncident(incidentId: string, resolvedAt = nowIso()): Promise<Incident | null> {
    const result = await this.pool.query(
      "UPDATE incidents SET status = 'resolved', resolved_at = $1 WHERE id = $2 RETURNING *",
      [resolvedAt, incidentId]
    );
    await this.loadState();
    return result.rows[0] ? mapIncident(result.rows[0]) : null;
  }

  async createMaintenanceWindow(tenantId: string, input: Omit<MaintenanceWindow, "id" | "tenantId">): Promise<MaintenanceWindow> {
    const maintenance: MaintenanceWindow = {
      ...input,
      id: `maintenance-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    await this.pool.query(
      "INSERT INTO maintenance_windows (id, tenant_id, service_id, title, description, starts_at, ends_at, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        maintenance.id,
        tenantId,
        maintenance.serviceId,
        maintenance.title,
        maintenance.description,
        maintenance.startsAt,
        maintenance.endsAt,
        maintenance.status,
        maintenance.createdBy
      ]
    );
    await this.loadState();
    return maintenance;
  }

  async resolveMaintenanceWindow(windowId: string, resolvedAt = nowIso()): Promise<MaintenanceWindow | null> {
    const result = await this.pool.query(
      "UPDATE maintenance_windows SET status = 'resolved', ends_at = $1 WHERE id = $2 RETURNING *",
      [resolvedAt, windowId]
    );
    await this.loadState();
    return result.rows[0] ? mapMaintenance(result.rows[0]) : null;
  }

  async updateBanner(bannerId: string, patch: Partial<Banner>): Promise<Banner | null> {
    this.ensureState();
    const current = this.state!.banners.find((banner) => banner.id === bannerId);
    if (!current) {
      return null;
    }
    const nextSeverity = patch.severity ?? current.severity;
    const next = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
      severityTrend: patch.severity ? severityTrend(current.severity, nextSeverity) : "unchanged"
    };
    await this.pool.query(
      "UPDATE banners SET scope_type = $1, scope_ref = $2, title = $3, message = $4, severity = $5, starts_at = $6, ends_at = $7, active = $8, updated_at = $9, severity_trend = $10 WHERE id = $11",
      [
        next.scopeType,
        next.scopeRef,
        next.title,
        next.message,
        next.severity,
        next.startsAt,
        next.endsAt,
        next.active,
        next.updatedAt,
        next.severityTrend,
        bannerId
      ]
    );
    await this.loadState();
    return next;
  }

  async toggleBanner(bannerId: string): Promise<Banner | null> {
    this.ensureState();
    const current = this.state!.banners.find((banner) => banner.id === bannerId);
    if (!current) {
      return null;
    }
    return this.updateBanner(bannerId, { active: !current.active });
  }

  async deleteBanner(bannerId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM banners WHERE id = $1", [bannerId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
  }

  async createTab(tenantId: string, input: Omit<TabDefinition, "id" | "tenantId">): Promise<TabDefinition> {
    const tab: TabDefinition = {
      ...input,
      id: `tab-${slugify(input.title)}-${Date.now()}`,
      tenantId
    };
    await this.pool.query(
      "INSERT INTO tabs (id, tenant_id, title, slug, sort_order, filter_query, is_global, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [tab.id, tenantId, tab.title, tab.slug, tab.sortOrder, tab.filterQuery, tab.isGlobal, tab.enabled]
    );
    await this.loadState();
    return tab;
  }

  async updateTab(tabId: string, patch: Partial<Omit<TabDefinition, "id" | "tenantId">>): Promise<TabDefinition | null> {
    this.ensureState();
    const current = this.state!.tabs.find((tab) => tab.id === tabId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    await this.pool.query(
      "UPDATE tabs SET title = $1, slug = $2, sort_order = $3, filter_query = $4, is_global = $5, enabled = $6 WHERE id = $7",
      [next.title, next.slug, next.sortOrder, next.filterQuery, next.isGlobal, next.enabled, tabId]
    );
    await this.loadState();
    return next;
  }

  async deleteTab(tabId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM tabs WHERE id = $1", [tabId]);
    await this.loadState();
    return (result.rowCount ?? 0) > 0;
  }

  async updateTabs(tabs: TabDefinition[]): Promise<TabDefinition[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM tabs");
      for (const tab of tabs) {
        await client.query(
          "INSERT INTO tabs (id, tenant_id, title, slug, sort_order, filter_query, is_global, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [tab.id, tab.tenantId, tab.title, tab.slug, tab.sortOrder, tab.filterQuery, tab.isGlobal, tab.enabled]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.loadState();
    return tabs;
  }

  async saveSnapshot(snapshot: Snapshot): Promise<Snapshot> {
    const previousSnapshot = await this.getLatestSnapshot(snapshot.tenantId);
    const existingSummaries = await this.getDailySummaries(snapshot.tenantId);
    const updatedSummaries = buildUpdatedDailySummaries(previousSnapshot, snapshot, existingSummaries);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO snapshots (id, tenant_id, collected_at, overall_status, services, raw_payload) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT (tenant_id) DO UPDATE SET id = EXCLUDED.id, collected_at = EXCLUDED.collected_at, overall_status = EXCLUDED.overall_status, services = EXCLUDED.services, raw_payload = EXCLUDED.raw_payload",
        [snapshot.id, snapshot.tenantId, snapshot.collectedAt, snapshot.overallStatus, JSON.stringify(snapshot.services), JSON.stringify(snapshot.rawPayload)]
      );
      await client.query("DELETE FROM daily_status_summaries WHERE tenant_id = $1", [snapshot.tenantId]);
      for (const summary of updatedSummaries) {
        await client.query(
          "INSERT INTO daily_status_summaries (tenant_id, day, overall_status, seconds_by_status, first_collected_at, last_collected_at, sample_count, service_summaries) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)",
          [
            summary.tenantId,
            summary.day,
            summary.overallStatus,
            JSON.stringify(summary.secondsByStatus),
            summary.firstCollectedAt,
            summary.lastCollectedAt,
            summary.sampleCount,
            JSON.stringify(summary.serviceSummaries)
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const currentState = this.state!;
    this.state = {
      ...currentState,
      snapshots: [...currentState.snapshots.filter((entry) => entry.tenantId !== snapshot.tenantId), snapshot],
      dailySummaries: [...currentState.dailySummaries.filter((entry) => entry.tenantId !== snapshot.tenantId), ...updatedSummaries]
    };
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

  private ensureState(): void {
    if (!this.state) {
      throw new Error("PostgresStore has not been initialized");
    }
  }

  private async freshState(): Promise<SeedState> {
    this.ensureState();
    await this.loadState();
    return this.state!;
  }

  private async normalizeLegacySnapshotData(): Promise<void> {
    const summaryCount = await this.pool.query("SELECT count(*)::int AS count FROM daily_status_summaries");
    const serviceSummaryCount = await this.pool.query(
      "SELECT count(*)::int AS count FROM daily_status_summaries WHERE jsonb_array_length(service_summaries) > 0"
    );
    const snapshotRows = await this.pool.query("SELECT * FROM snapshots ORDER BY tenant_id, collected_at");
    const shouldRebuildSummaries =
      Number(summaryCount.rows[0]?.count ?? 0) === 0 ||
      (snapshotRows.rows.length > 0 && Number(serviceSummaryCount.rows[0]?.count ?? 0) === 0);

    await this.pool.query(`
      DELETE FROM snapshots
      WHERE id NOT IN (
        SELECT DISTINCT ON (tenant_id) id
        FROM snapshots
        ORDER BY tenant_id, collected_at DESC, id DESC
      );
    `);
    await this.pool.query("CREATE UNIQUE INDEX IF NOT EXISTS snapshots_tenant_id_unique ON snapshots (tenant_id)");

    if (!shouldRebuildSummaries) {
      return;
    }

    const summaries = new Map<string, StatusDailySummary>();
    const historyByTenant = new Map<string, Snapshot[]>();
    for (const row of snapshotRows.rows) {
      const snapshot = mapSnapshot(row);
      const tenantSnapshots = historyByTenant.get(snapshot.tenantId) ?? [];
      tenantSnapshots.push(snapshot);
      historyByTenant.set(snapshot.tenantId, tenantSnapshots);
    }

    for (const tenantSnapshots of historyByTenant.values()) {
      let previous: Snapshot | null = null;
      for (const snapshot of tenantSnapshots) {
        const day = utcDayKey(snapshot.collectedAt);
        const currentKey = `${snapshot.tenantId}:${day}`;
        const currentSummary = summaries.get(currentKey) ?? createEmptyDailySummary(snapshot.tenantId, day, snapshot.collectedAt);
        addObservation(currentSummary, snapshot.overallStatus, snapshot.collectedAt);
        for (const service of snapshot.services) {
          addServiceObservation(currentSummary, service, snapshot.collectedAt);
        }
        summaries.set(currentKey, currentSummary);

        if (previous) {
          for (const segment of splitUtcIntervalByDay(previous.collectedAt, snapshot.collectedAt)) {
            const segmentKey = `${snapshot.tenantId}:${segment.day}`;
            const summary = summaries.get(segmentKey) ?? createEmptyDailySummary(snapshot.tenantId, segment.day, segment.segmentStart);
            addDuration(summary, previous.overallStatus, segment.seconds, segment.segmentEnd);
            for (const service of previous.services) {
              addServiceDuration(summary, service, segment.seconds, segment.segmentEnd);
            }
            summary.firstCollectedAt = segment.segmentStart < summary.firstCollectedAt ? segment.segmentStart : summary.firstCollectedAt;
            summary.lastCollectedAt = segment.segmentEnd > summary.lastCollectedAt ? segment.segmentEnd : summary.lastCollectedAt;
            summaries.set(segmentKey, summary);
          }
        }

        previous = snapshot;
      }
    }

    for (const summary of summaries.values()) {
      await this.pool.query(
        "INSERT INTO daily_status_summaries (tenant_id, day, overall_status, seconds_by_status, first_collected_at, last_collected_at, sample_count, service_summaries) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) ON CONFLICT (tenant_id, day) DO UPDATE SET overall_status = EXCLUDED.overall_status, seconds_by_status = EXCLUDED.seconds_by_status, first_collected_at = EXCLUDED.first_collected_at, last_collected_at = EXCLUDED.last_collected_at, sample_count = EXCLUDED.sample_count, service_summaries = EXCLUDED.service_summaries",
        [
          summary.tenantId,
          summary.day,
          summary.overallStatus,
          JSON.stringify(summary.secondsByStatus),
          summary.firstCollectedAt,
          summary.lastCollectedAt,
          summary.sampleCount,
          JSON.stringify(summary.serviceSummaries)
        ]
      );
    }
  }

  private async seedIfEmpty(): Promise<void> {
    const tenantCount = await this.pool.query("SELECT count(*)::int AS count FROM tenants");
    if (Number(tenantCount.rows[0]?.count ?? 0) > 0) {
      return;
    }

    const seed = buildSeedState(this.config);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO app_settings (id, app_name, logo_url, favicon_url, theme_default, auth_settings_json, notification_settings_json) VALUES (1, $1, $2, $3, $4, $5::jsonb, $6::jsonb) ON CONFLICT (id) DO UPDATE SET app_name = EXCLUDED.app_name, logo_url = EXCLUDED.logo_url, favicon_url = EXCLUDED.favicon_url, theme_default = EXCLUDED.theme_default, auth_settings_json = EXCLUDED.auth_settings_json, notification_settings_json = EXCLUDED.notification_settings_json",
        [
          seed.branding.appName,
          seed.branding.logoUrl,
          seed.branding.faviconUrl,
          seed.branding.themeDefault,
          JSON.stringify(seed.platformSettings.auth),
          JSON.stringify(seed.platformSettings.notifications)
        ]
      );

      for (const tenant of seed.tenants) {
        await client.query(
          "INSERT INTO tenants (id, slug, name, description, enabled) VALUES ($1,$2,$3,$4,$5)",
          [tenant.id, tenant.slug, tenant.name, tenant.description, tenant.enabled]
        );
      }

      for (const tab of seed.tabs) {
        await client.query(
          "INSERT INTO tabs (id, tenant_id, title, slug, sort_order, filter_query, is_global, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [tab.id, tab.tenantId, tab.title, tab.slug, tab.sortOrder, tab.filterQuery, tab.isGlobal, tab.enabled]
        );
      }

      for (const service of seed.services) {
        await client.query(
          "INSERT INTO services (id, tenant_id, name, slug, category, topic, tags, source_type, source_ref, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
          [service.id, service.tenantId, service.name, service.slug, service.category, service.topic, JSON.stringify(service.tags), service.sourceType, service.sourceRef, service.enabled]
        );
      }

      for (const connector of seed.connectors) {
        await client.query(
          "INSERT INTO connectors (id, tenant_id, type, name, config_json, auth_json, enabled, poll_interval_seconds, last_success_at, last_error_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)",
          [
            connector.id,
            connector.tenantId,
            connector.type,
            connector.name,
            connector.configJson,
            connector.authJson,
            connector.enabled,
            connector.pollIntervalSeconds,
            connector.lastSuccessAt,
            connector.lastErrorAt
          ]
        );
      }

      for (const banner of seed.banners) {
        await client.query(
          "INSERT INTO banners (id, tenant_id, scope_type, scope_ref, title, message, severity, starts_at, ends_at, updated_at, severity_trend, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            banner.id,
            banner.tenantId,
            banner.scopeType,
            banner.scopeRef,
            banner.title,
            banner.message,
            banner.severity,
            banner.startsAt,
            banner.endsAt,
            banner.updatedAt,
            banner.severityTrend,
            banner.active
          ]
        );
      }

      for (const incident of seed.incidents) {
        await client.query(
          "INSERT INTO incidents (id, tenant_id, service_id, title, description, status, opened_at, resolved_at, source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            incident.id,
            incident.tenantId,
            incident.serviceId,
            incident.title,
            incident.description,
            incident.status,
            incident.openedAt,
            incident.resolvedAt,
            incident.sourceType
          ]
        );
      }

      for (const maintenance of seed.maintenance) {
        await client.query(
          "INSERT INTO maintenance_windows (id, tenant_id, service_id, title, description, starts_at, ends_at, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            maintenance.id,
            maintenance.tenantId,
            maintenance.serviceId,
            maintenance.title,
            maintenance.description,
            maintenance.startsAt,
            maintenance.endsAt,
            maintenance.status,
            maintenance.createdBy
          ]
        );
      }

      for (const subscription of seed.subscriptions) {
        await client.query(
          "INSERT INTO subscriptions (id, tenant_id, service_id, channel_type, target, enabled) VALUES ($1,$2,$3,$4,$5,$6)",
          [subscription.id, subscription.tenantId, subscription.serviceId, subscription.channelType, subscription.target, subscription.enabled]
        );
      }

      for (const color of seed.colors) {
        await client.query(
          "INSERT INTO colors (tenant_id, status_key, color_hex, label) VALUES ($1,$2,$3,$4)",
          [color.tenantId, color.statusKey, color.colorHex, color.label]
        );
      }

      for (const snapshot of seed.snapshots) {
        await client.query(
          "INSERT INTO snapshots (id, tenant_id, collected_at, overall_status, services, raw_payload) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT (tenant_id) DO UPDATE SET id = EXCLUDED.id, collected_at = EXCLUDED.collected_at, overall_status = EXCLUDED.overall_status, services = EXCLUDED.services, raw_payload = EXCLUDED.raw_payload",
          [snapshot.id, snapshot.tenantId, snapshot.collectedAt, snapshot.overallStatus, JSON.stringify(snapshot.services), JSON.stringify(snapshot.rawPayload)]
        );
        const day = utcDayKey(snapshot.collectedAt);
        const summary = seed.dailySummaries.find((entry) => entry.tenantId === snapshot.tenantId && entry.day === day);
        await client.query(
          "INSERT INTO daily_status_summaries (tenant_id, day, overall_status, seconds_by_status, first_collected_at, last_collected_at, sample_count, service_summaries) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)",
          [
            snapshot.tenantId,
            day,
            snapshot.overallStatus,
            JSON.stringify(summary?.secondsByStatus ?? emptySecondsByStatus()),
            snapshot.collectedAt,
            snapshot.collectedAt,
            summary?.sampleCount ?? 1,
            JSON.stringify(summary?.serviceSummaries ?? [])
          ]
        );
      }

      for (const user of seed.users) {
        await client.query(
          "INSERT INTO users (id, username, display_name, email, auth_type, is_admin, enabled, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [user.id, user.username, user.displayName, user.email, user.authType, user.isAdmin, user.enabled, hashPassword(this.config.adminPassword)]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadState(): Promise<void> {
    const [settings, tenants, tabs, services, banners, incidents, maintenance, subscriptions, colors, snapshots, dailySummaries, users] = await Promise.all([
      this.pool.query("SELECT * FROM app_settings WHERE id = 1"),
      this.pool.query("SELECT * FROM tenants ORDER BY name"),
      this.pool.query("SELECT * FROM tabs ORDER BY sort_order, title"),
      this.pool.query("SELECT * FROM services ORDER BY name"),
      this.pool.query("SELECT * FROM banners ORDER BY active DESC, title"),
      this.pool.query("SELECT * FROM incidents ORDER BY opened_at DESC"),
      this.pool.query("SELECT * FROM maintenance_windows ORDER BY starts_at DESC"),
      this.pool.query("SELECT * FROM subscriptions ORDER BY channel_type, target"),
      this.pool.query("SELECT * FROM colors ORDER BY status_key"),
      this.pool.query("SELECT * FROM snapshots ORDER BY collected_at"),
      this.pool.query("SELECT * FROM daily_status_summaries ORDER BY day DESC"),
      this.pool.query("SELECT * FROM users ORDER BY username")
    ]);

    const setting = settings.rows[0] ?? {
      app_name: this.config.appName,
      logo_url: this.config.logoUrl,
      favicon_url: this.config.faviconUrl,
      theme_default: this.config.themeDefault,
      auth_settings_json: null,
      notification_settings_json: null
    };
    const platformSettings = normalizePlatformSettings(
      {
        auth: parseJson(setting.auth_settings_json, platformSettingsFromConfig(this.config).auth),
        notifications: parseJson(setting.notification_settings_json, platformSettingsFromConfig(this.config).notifications)
      },
      platformSettingsFromConfig(this.config)
    );

    this.state = {
      meta: {
        appName: String(setting.app_name),
        logoUrl: String(setting.logo_url ?? ""),
        faviconUrl: String(setting.favicon_url ?? ""),
        themeDefault: String(setting.theme_default) as AppMeta["themeDefault"],
        publicAuthMode: platformSettings.auth.publicAuthMode,
        adminAuthModes: platformSettings.auth.adminAuthModes
      },
      branding: {
        appName: String(setting.app_name),
        logoUrl: String(setting.logo_url ?? ""),
        faviconUrl: String(setting.favicon_url ?? ""),
        themeDefault: String(setting.theme_default) as AppMeta["themeDefault"]
      },
      tenants: tenants.rows.map(mapTenant),
      tabs: tabs.rows.map(mapTab),
      services: services.rows.map(mapService),
      connectors: (await this.pool.query("SELECT * FROM connectors ORDER BY name")).rows.map(mapConnector),
      banners: banners.rows.map(mapBanner),
      incidents: incidents.rows.map(mapIncident),
      maintenance: maintenance.rows.map(mapMaintenance),
      subscriptions: subscriptions.rows.map(mapSubscription),
      colors: colors.rows.map(mapColor),
      snapshots: snapshots.rows.map(mapSnapshot),
      dailySummaries: dailySummaries.rows.map(mapDailySummary),
      users: users.rows.map(mapUser),
      platformSettings
    };
  }
}
