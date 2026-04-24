export type StatusLevel = "healthy" | "degraded" | "down" | "maintenance" | "unknown";
export type ThemeMode = "light" | "dark";
export type AuthMode = "public" | "ip" | "local" | "ldap" | "saml" | "oauth" | "oidc";
export type BannerScope = "global" | "tenant" | "tab" | "category" | "service";
export type BannerSeverityTrend = "improved" | "worse" | "unchanged";
export type ConnectorType = "zabbix" | "prometheus" | "prtg" | "webhook";

export interface Branding {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  themeDefault: ThemeMode;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface TabDefinition {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  sortOrder: number;
  filterQuery: string;
  isGlobal: boolean;
  enabled: boolean;
}

export interface ServiceDefinition {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  category: string;
  topic: string;
  tags: string[];
  sourceType: ConnectorType;
  sourceRef: string;
  enabled: boolean;
}

export interface IntegrationConnector {
  id: string;
  tenantId: string;
  type: ConnectorType;
  name: string;
  configJson: string;
  authJson: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  maintenanceEnabled: boolean;
  maintenanceStartAt: string | null;
  maintenanceEndAt: string | null;
  maintenanceMessage: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface Banner {
  id: string;
  tenantId: string;
  scopeType: BannerScope;
  scopeRef: string;
  title: string;
  message: string;
  severity: StatusLevel;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string | null;
  severityTrend: BannerSeverityTrend | null;
  active: boolean;
}

export interface Incident {
  id: string;
  tenantId: string;
  serviceId: string;
  title: string;
  description: string;
  status: "open" | "resolved";
  openedAt: string;
  resolvedAt: string | null;
  sourceType: ConnectorType | "manual";
}

export interface MaintenanceWindow {
  id: string;
  tenantId: string;
  serviceId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  status: "scheduled" | "active" | "resolved";
  createdBy: string;
}

export interface NotificationSubscription {
  id: string;
  tenantId: string;
  serviceId: string | null;
  channelType: "slack" | "email";
  target: string;
  enabled: boolean;
}

export interface AuthSettings {
  publicAuthMode: AuthMode;
  adminAuthModes: AuthMode[];
  allowedIpRanges: string[];
  ldap: {
    url: string;
    baseDn: string;
    bindDn: string;
    bindPassword: string;
    userFilter: string;
    usernameAttribute: string;
    displayNameAttribute: string;
    emailAttribute: string;
  };
  remoteAuth: {
    userinfoUrl: string;
    introspectionUrl: string;
    clientId: string;
    clientSecret: string;
    usernameClaim: string;
    displayNameClaim: string;
    emailClaim: string;
  };
  oidc: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    usernameClaim: string;
    displayNameClaim: string;
    emailClaim: string;
    prompt: string;
    useUserInfo: boolean;
  };
  saml: {
    entryPoint: string;
    issuer: string;
    idpCert: string;
    privateKey: string;
    publicCert: string;
    nameIdAttribute: string;
    displayNameAttribute: string;
    emailAttribute: string;
  };
}

export interface NotificationSettings {
  slackWebhookUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
}

export interface PlatformSettings {
  auth: AuthSettings;
  notifications: NotificationSettings;
}

export interface ColorMapping {
  tenantId: string;
  statusKey: StatusLevel;
  colorHex: string;
  label: string;
}

export interface Snapshot {
  id: string;
  tenantId: string;
  collectedAt: string;
  overallStatus: StatusLevel;
  services: Array<{
    serviceId: string;
    status: StatusLevel;
    summary: string;
    lastCheckedAt: string;
  }>;
  rawPayload: unknown;
}

export interface ServiceStatusEvent {
  id: string;
  tenantId: string;
  serviceId: string;
  snapshotId: string;
  collectedAt: string;
  status: StatusLevel;
  summary: string;
  sourceType: ConnectorType;
  sourceRef: string;
}

export interface ServiceDailySummary {
  tenantId: string;
  serviceId: string;
  day: string;
  overallStatus: StatusLevel;
  secondsByStatus: Record<StatusLevel, number>;
  firstCollectedAt: string;
  lastCollectedAt: string;
  sampleCount: number;
  latestSummary: string;
}

export interface StatusDailySummary {
  tenantId: string;
  day: string;
  overallStatus: StatusLevel;
  secondsByStatus: Record<StatusLevel, number>;
  firstCollectedAt: string;
  lastCollectedAt: string;
  sampleCount: number;
  serviceSummaries: ServiceDailySummary[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  authType: "local" | "ldap" | "sso";
  isAdmin: boolean;
  enabled: boolean;
}

export interface AppMeta {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  themeDefault: ThemeMode;
  publicAuthMode: AuthMode;
  adminAuthModes: AuthMode[];
}

export interface StatusView {
  meta: AppMeta;
  tenants: Tenant[];
  tabs: TabDefinition[];
  services: ServiceDefinition[];
  connectors: IntegrationConnector[];
  banners: Banner[];
  incidents: Incident[];
  maintenance: MaintenanceWindow[];
  subscriptions: NotificationSubscription[];
  colors: ColorMapping[];
  snapshot: Snapshot | null;
  serviceEvents: ServiceStatusEvent[];
  dailySummaries: StatusDailySummary[];
}
