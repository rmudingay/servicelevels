import type {
  AdminUser,
  AppMeta,
  Banner,
  Branding,
  ColorMapping,
  Incident,
  IntegrationConnector,
  MaintenanceWindow,
  NotificationSubscription,
  PlatformSettings,
  StatusView,
  TabDefinition,
  Tenant,
  AuthMode
} from "@service-levels/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window === "undefined" ? "http://localhost:8080" : `${window.location.protocol}//${window.location.hostname}:8080`);

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(text || response.statusText, response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

export const api = {
  meta: () => fetchJson<AppMeta>("/api/v1/meta"),
  authOptions: () =>
    fetchJson<{
      publicAuthMode: AuthMode;
      adminAuthModes: AuthMode[];
      redirectAuthModes: Array<"oidc" | "oauth" | "saml">;
      labels: Record<AuthMode, string>;
    }>("/api/v1/auth/options"),
  status: (tenant?: string) => fetchJson<StatusView>(`/api/v1/status${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  tenants: () => fetchJson<Tenant[]>("/api/v1/admin/tenants"),
  users: () => fetchJson<AdminUser[]>("/api/v1/admin/users"),
  tabs: (tenant?: string) => fetchJson<TabDefinition[]>(`/api/v1/admin/tabs${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  banners: (tenant?: string) => fetchJson<Banner[]>(`/api/v1/admin/banners${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  incidents: (tenant?: string) => fetchJson<Incident[]>(`/api/v1/admin/incidents${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  maintenance: (tenant?: string) => fetchJson<MaintenanceWindow[]>(`/api/v1/admin/maintenance${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  subscriptions: (tenant?: string) => fetchJson<NotificationSubscription[]>(`/api/v1/admin/subscriptions${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  colors: (tenant?: string) => fetchJson<ColorMapping[]>(`/api/v1/admin/colors${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  connectors: (tenant?: string) => fetchJson<IntegrationConnector[]>(`/api/v1/admin/connectors${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`),
  platformSettings: () => fetchJson<PlatformSettings>("/api/v1/admin/platform-settings"),
  collectionHealth: () =>
    fetchJson<{
      generatedAt: string;
      tenants: Array<{
        tenant: Tenant;
        overallStatus: string;
        latestSnapshotAt: string | null;
        latestSnapshotAgeSeconds: number | null;
        connectors: Array<{
          id: string;
          name: string;
          type: IntegrationConnector["type"];
          enabled: boolean;
          pollIntervalSeconds: number;
          lastSuccessAt: string | null;
          lastErrorAt: string | null;
          nextDueAt: string | null;
          isDue: boolean;
        }>;
      }>;
    }>("/api/v1/admin/collection-health"),
  createTenant: (body: { name: string; slug: string; description: string; enabled: boolean }) =>
    fetchJson<Tenant>("/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateTenant: (id: string, body: Partial<Pick<Tenant, "name" | "slug" | "description" | "enabled">>) =>
    fetchJson<Tenant | null>(`/api/v1/admin/tenants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteTenant: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/v1/admin/tenants/${id}`, {
      method: "DELETE"
    }),
  createTab: (body: { tenantSlug: string; title: string; filterQuery: string; isGlobal: boolean }) =>
    fetchJson<TabDefinition>("/api/v1/admin/tabs", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  createConnector: (body: {
    tenantSlug: string;
    type: IntegrationConnector["type"];
    name: string;
    configJson: string;
    authJson: string;
    enabled: boolean;
    pollIntervalSeconds: number;
  }) =>
    fetchJson<IntegrationConnector>("/api/v1/admin/connectors", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateConnector: (
    id: string,
    body: Partial<Pick<IntegrationConnector, "type" | "name" | "configJson" | "authJson" | "enabled" | "pollIntervalSeconds">>
  ) =>
    fetchJson<IntegrationConnector | null>(`/api/v1/admin/connectors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteConnector: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/v1/admin/connectors/${id}`, {
      method: "DELETE"
    }),
  branding: () => fetchJson<Branding>("/api/v1/admin/branding"),
  login: (body: {
    mode: AuthMode;
    username?: string;
    password?: string;
  }) =>
    fetchJson<{ ok: boolean }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  logout: () => fetchJson<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  me: () => fetchJson<{ user: unknown; meta: AppMeta }>("/api/v1/admin/me"),
  createUser: (body: {
    username: string;
    displayName: string;
    email: string;
    authType: "local" | "ldap" | "sso";
    password?: string;
    enabled: boolean;
  }) =>
    fetchJson<AdminUser>("/api/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateUser: (
    id: string,
    body: Partial<{
      username: string;
      displayName: string;
      email: string;
      authType: "local" | "ldap" | "sso";
      password: string;
      enabled: boolean;
    }>
  ) =>
    fetchJson<AdminUser | null>(`/api/v1/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  promoteUser: (id: string) =>
    fetchJson<AdminUser>(`/api/v1/admin/users/${id}/promote`, {
      method: "POST"
    }),
  demoteUser: (id: string) =>
    fetchJson<AdminUser>(`/api/v1/admin/users/${id}/demote`, {
      method: "POST"
    }),
  updatePlatformSettings: (body: PlatformSettings) =>
    fetchJson<PlatformSettings>("/api/v1/admin/platform-settings", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  updateBranding: (body: Partial<Branding>) =>
    fetchJson<Branding>("/api/v1/admin/branding", {
      method: "PUT",
      body: JSON.stringify(body)
    }),
  updateColors: (tenantSlug: string, colors: ColorMapping[]) =>
    fetchJson<ColorMapping[]>("/api/v1/admin/colors", {
      method: "PUT",
      body: JSON.stringify({ tenantSlug, colors })
    }),
  createBanner: (body: {
    tenantSlug: string;
    scopeType: Banner["scopeType"];
    scopeRef: string;
    title: string;
    message: string;
    severity: Banner["severity"];
  }) =>
    fetchJson<Banner>("/api/v1/admin/banners", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  updateBanner: (id: string, body: Partial<Pick<Banner, "scopeType" | "scopeRef" | "title" | "message" | "severity" | "startsAt" | "endsAt" | "active">>) =>
    fetchJson<Banner | null>(`/api/v1/admin/banners/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  deleteBanner: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/v1/admin/banners/${id}`, {
      method: "DELETE"
    }),
  toggleBanner: (id: string) =>
    fetchJson<Banner>(`/api/v1/admin/banners/${id}/toggle`, {
      method: "POST"
    }),
  createSubscription: (body: {
    tenantSlug: string;
    serviceId?: string | null;
    channelType: "slack" | "email";
    target: string;
    enabled: boolean;
  }) =>
    fetchJson<NotificationSubscription>("/api/v1/admin/subscriptions", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteSubscription: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/v1/admin/subscriptions/${id}`, {
      method: "DELETE"
    }),
  ssoStartUrl: (mode: "oidc" | "oauth" | "saml", target: "status" | "admin", returnTo: string) =>
    `${API_BASE_URL}/api/v1/auth/sso/${mode}/start?target=${encodeURIComponent(target)}&returnTo=${encodeURIComponent(returnTo)}`
};
