import type {
  AdminUser,
  AppMeta,
  Banner,
  Branding,
  ColorMapping,
  Incident,
  ServiceDefinition,
  MaintenanceWindow,
  NotificationSubscription,
  PlatformSettings,
  Snapshot,
  StatusDailySummary,
  StatusLevel,
  StatusView,
  TabDefinition,
  Tenant,
  IntegrationConnector
} from "@service-levels/shared";

export interface StatusRepository {
  getMeta(): Promise<AppMeta>;
  getBranding(): Promise<Branding>;
  getPlatformSettings(): Promise<PlatformSettings>;
  getTenants(): Promise<Tenant[]>;
  getTabs(tenantId?: string): Promise<TabDefinition[]>;
  getServices(tenantId?: string): Promise<ServiceDefinition[]>;
  getConnectors(tenantId?: string): Promise<IntegrationConnector[]>;
  getBanners(tenantId?: string): Promise<Banner[]>;
  getIncidents(tenantId?: string): Promise<Incident[]>;
  getMaintenanceWindows(tenantId?: string): Promise<MaintenanceWindow[]>;
  getSubscriptions(tenantId?: string): Promise<NotificationSubscription[]>;
  getDailySummaries(tenantId?: string): Promise<StatusDailySummary[]>;
  getColors(tenantId?: string): Promise<ColorMapping[]>;
  getLatestSnapshot(tenantId?: string): Promise<Snapshot | null>;
  getStatusView(tenantSlug?: string): Promise<StatusView>;
  listUsers(): Promise<AdminUser[]>;
  findUserByUsername(username: string): Promise<AdminUser | undefined>;
  findUserById(id: string): Promise<AdminUser | undefined>;
  verifyLocalCredentials(username: string, password: string): Promise<AdminUser | null>;
  createUser(input: Omit<AdminUser, "id"> & { password?: string | null }): Promise<AdminUser>;
  updateUser(userId: string, patch: Partial<AdminUser> & { password?: string | null }): Promise<AdminUser | null>;
  setUserAdmin(userId: string, isAdmin: boolean): Promise<AdminUser | null>;
  upsertExternalUser(
    input: Pick<AdminUser, "username" | "displayName" | "email" | "authType"> & { enabled?: boolean; isAdmin?: boolean }
  ): Promise<AdminUser>;
  updatePlatformSettings(input: PlatformSettings): Promise<PlatformSettings>;
  updateBranding(input: Partial<Branding>): Promise<Branding>;
  updateColors(tenantId: string, updates: Array<{ statusKey: StatusLevel; colorHex: string; label: string }>): Promise<ColorMapping[]>;
  createTenant(input: Omit<Tenant, "id">): Promise<Tenant>;
  updateTenant(tenantId: string, patch: Partial<Tenant>): Promise<Tenant | null>;
  deleteTenant(tenantId: string): Promise<boolean>;
  createSubscription(tenantId: string, input: Omit<NotificationSubscription, "id" | "tenantId">): Promise<NotificationSubscription>;
  deleteSubscription(subscriptionId: string): Promise<boolean>;
  createConnector(tenantId: string, input: Omit<IntegrationConnector, "id" | "tenantId" | "lastSuccessAt" | "lastErrorAt">): Promise<IntegrationConnector>;
  updateConnector(connectorId: string, patch: Partial<IntegrationConnector>): Promise<IntegrationConnector | null>;
  deleteConnector(connectorId: string): Promise<boolean>;
  createBanner(tenantId: string, input: Omit<Banner, "id" | "tenantId">): Promise<Banner>;
  updateBanner(bannerId: string, patch: Partial<Banner>): Promise<Banner | null>;
  deleteBanner(bannerId: string): Promise<boolean>;
  toggleBanner(bannerId: string): Promise<Banner | null>;
  createIncident(tenantId: string, input: Omit<Incident, "id" | "tenantId">): Promise<Incident>;
  resolveIncident(incidentId: string, resolvedAt?: string): Promise<Incident | null>;
  createMaintenanceWindow(tenantId: string, input: Omit<MaintenanceWindow, "id" | "tenantId">): Promise<MaintenanceWindow>;
  resolveMaintenanceWindow(windowId: string, resolvedAt?: string): Promise<MaintenanceWindow | null>;
  createTab(tenantId: string, input: Omit<TabDefinition, "id" | "tenantId">): Promise<TabDefinition>;
  updateTabs(tabs: TabDefinition[]): Promise<TabDefinition[]>;
  saveSnapshot(snapshot: Snapshot): Promise<Snapshot>;
  computeOverallStatus(tenantId: string): Promise<StatusLevel>;
  getMaintenanceBanners(tenantId: string): Promise<Banner[]>;
}
