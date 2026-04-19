import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppMeta, AuthMode, StatusView } from "@service-levels/shared";
import {
  AdminPage,
  StatusPage,
  authModeLabel,
  authModeUsesPassword,
  authModeUsesRedirect,
  bannerMatchesScope,
  browserRedirect,
  colorFor,
  currentReturnPath,
  matchesFilter,
  statusLabel,
  statusRank
} from "./App";

const mockApi = vi.hoisted(() => ({
  authOptions: vi.fn(),
  status: vi.fn(),
  me: vi.fn(),
  meta: vi.fn(),
  branding: vi.fn(),
  colors: vi.fn(),
  tabs: vi.fn(),
  connectors: vi.fn(),
  collectionHealth: vi.fn(),
  users: vi.fn(),
  incidents: vi.fn(),
  maintenance: vi.fn(),
  subscriptions: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  createBanner: vi.fn(),
  createSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  createTab: vi.fn(),
  createConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  promoteUser: vi.fn(),
  demoteUser: vi.fn(),
  updateBranding: vi.fn(),
  updateColors: vi.fn(),
  ssoStartUrl: vi.fn(() => "/sso")
}));

const MockApiError = vi.hoisted(
  () =>
    class extends Error {
      status: number;

      constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
      }
    }
);

vi.mock("./api", () => ({
  api: mockApi,
  ApiError: MockApiError
}));

function buildMeta(): AppMeta & { adminAuthModes: AuthMode[] } {
  return {
    appName: "Service Levels application",
    logoUrl: "",
    faviconUrl: "",
    themeDefault: "dark",
    publicAuthMode: "public",
    adminAuthModes: ["local"]
  };
}

function buildStatusView(): StatusView {
  return {
    meta: buildMeta(),
    tenants: [
      {
        id: "tenant-primary-site",
        slug: "primary-site",
        name: "Primary Site",
        description: "Primary service view",
        enabled: true
      },
      {
        id: "tenant-edge-site",
        slug: "edge-site",
        name: "Edge Site",
        description: "Remote systems view",
        enabled: true
      }
    ],
    tabs: [
      {
        id: "tab-global",
        tenantId: "tenant-primary-site",
        title: "Global",
        slug: "global",
        sortOrder: 1,
        filterQuery: "",
        isGlobal: true,
        enabled: true
      },
      {
        id: "tab-network",
        tenantId: "tenant-primary-site",
        title: "Network",
        slug: "network",
        sortOrder: 2,
        filterQuery: "category:network tag:critical",
        isGlobal: false,
        enabled: true
      }
    ],
    services: [
      {
        id: "svc-prom",
        tenantId: "tenant-primary-site",
        name: "Metrics Pipeline",
        slug: "metrics-pipeline",
        category: "infrastructure",
        topic: "metrics",
        tags: ["metrics"],
        sourceType: "prometheus",
        sourceRef: "up",
        enabled: true
      },
      {
        id: "svc-network",
        tenantId: "tenant-primary-site",
        name: "Core Router",
        slug: "core-router",
        category: "network",
        topic: "routing",
        tags: ["critical", "network"],
        sourceType: "zabbix",
        sourceRef: "router",
        enabled: true
      }
    ],
    connectors: [
      {
        id: "connector-prometheus",
        tenantId: "tenant-primary-site",
        type: "prometheus",
        name: "Prometheus cluster",
        configJson: "{\n  \"mode\": \"alerts\"\n}",
        authJson: "{}",
        enabled: true,
        pollIntervalSeconds: 300,
        lastSuccessAt: "2026-04-20T09:55:00.000Z",
        lastErrorAt: null
      }
    ],
    banners: [
      {
        id: "banner-global",
        tenantId: "tenant-primary-site",
        scopeType: "global",
        scopeRef: "",
        title: "Portal notice",
        message: "Summary data is refreshed every five minutes.",
        severity: "maintenance",
        startsAt: "2026-04-20T09:00:00.000Z",
        endsAt: null,
        active: true
      },
      {
        id: "banner-service",
        tenantId: "tenant-primary-site",
        scopeType: "service",
        scopeRef: "core-router",
        title: "Route flap",
        message: "Investigating transient route instability.",
        severity: "degraded",
        startsAt: "2026-04-20T09:30:00.000Z",
        endsAt: null,
        active: true
      },
      {
        id: "banner-inactive",
        tenantId: "tenant-primary-site",
        scopeType: "tenant",
        scopeRef: "primary-site",
        title: "Inactive",
        message: "Hidden",
        severity: "healthy",
        startsAt: null,
        endsAt: null,
        active: false
      }
    ],
    incidents: [
      {
        id: "incident-router",
        tenantId: "tenant-primary-site",
        serviceId: "svc-network",
        title: "Router degraded",
        description: "Latency remains above the warning threshold.",
        status: "open",
        openedAt: "2026-04-20T09:45:00.000Z",
        resolvedAt: null,
        sourceType: "zabbix"
      }
    ],
    maintenance: [
      {
        id: "maintenance-prom",
        tenantId: "tenant-primary-site",
        serviceId: "svc-prom",
        title: "Metrics rollout",
        description: "Deploying Prometheus rules.",
        startsAt: "2026-04-20T08:00:00.000Z",
        endsAt: null,
        status: "active",
        createdBy: "admin"
      }
    ],
    subscriptions: [
      {
        id: "subscription-slack",
        tenantId: "tenant-primary-site",
        serviceId: null,
        channelType: "slack",
        target: "https://hooks.slack.com/services/T000/B000/abc",
        enabled: true
      }
    ],
    colors: [
      { tenantId: "tenant-primary-site", statusKey: "healthy", colorHex: "#3BB273", label: "Healthy" },
      { tenantId: "tenant-primary-site", statusKey: "degraded", colorHex: "#D9A441", label: "Degraded" },
      { tenantId: "tenant-primary-site", statusKey: "down", colorHex: "#D94B4B", label: "Down" },
      { tenantId: "tenant-primary-site", statusKey: "maintenance", colorHex: "#4A90E2", label: "Maintenance" },
      { tenantId: "tenant-primary-site", statusKey: "unknown", colorHex: "#7A7F87", label: "Unknown" }
    ],
    snapshot: {
      id: "snapshot-1",
      tenantId: "tenant-primary-site",
      collectedAt: "2026-04-20T10:00:00.000Z",
      overallStatus: "degraded",
      services: [
        {
          serviceId: "svc-prom",
          status: "maintenance",
          summary: "Prometheus rollout in progress",
          lastCheckedAt: "2026-04-20T10:00:00.000Z"
        },
        {
          serviceId: "svc-network",
          status: "degraded",
          summary: "Latency elevated on the core router",
          lastCheckedAt: "2026-04-20T10:00:00.000Z"
        }
      ],
      rawPayload: {}
    },
    dailySummaries: [
      {
        tenantId: "tenant-primary-site",
        day: "2026-04-20",
        overallStatus: "degraded",
        secondsByStatus: {
          healthy: 300,
          degraded: 600,
          down: 0,
          maintenance: 120,
          unknown: 0
        },
        firstCollectedAt: "2026-04-20T00:00:00.000Z",
        lastCollectedAt: "2026-04-20T10:00:00.000Z",
        sampleCount: 3
      }
    ]
  };
}

function primeAuthenticatedAdminMocks(view = buildStatusView()): void {
  mockApi.me.mockResolvedValue({ user: { username: "admin", isAdmin: true }, meta: buildMeta() });
  mockApi.meta.mockResolvedValue(buildMeta());
  mockApi.status.mockResolvedValue(view);
  mockApi.branding.mockResolvedValue(view.meta);
  mockApi.colors.mockResolvedValue(view.colors);
  mockApi.tabs.mockResolvedValue(view.tabs);
  mockApi.connectors.mockResolvedValue(view.connectors);
  mockApi.collectionHealth.mockResolvedValue({
    generatedAt: "2026-04-20T10:05:00.000Z",
    tenants: [
      {
        tenant: view.tenants[0],
        overallStatus: "degraded",
        latestSnapshotAt: "2026-04-20T10:00:00.000Z",
        latestSnapshotAgeSeconds: 300,
        connectors: [
          {
            id: "connector-prometheus",
            name: "Prometheus cluster",
            type: "prometheus",
            enabled: true,
            pollIntervalSeconds: 300,
            lastSuccessAt: "2026-04-20T10:00:00.000Z",
            lastErrorAt: null,
            nextDueAt: "2026-04-20T10:05:00.000Z",
            isDue: true
          }
        ]
      }
    ]
  });
  mockApi.users.mockResolvedValue([
    { id: "user-admin", username: "admin", displayName: "Admin", email: "admin@example.org", authType: "local", isAdmin: true, enabled: true },
    { id: "user-ops", username: "ops", displayName: "Ops", email: "ops@example.org", authType: "ldap", isAdmin: false, enabled: true }
  ]);
  mockApi.incidents.mockResolvedValue(view.incidents);
  mockApi.maintenance.mockResolvedValue(view.maintenance);
  mockApi.subscriptions.mockResolvedValue(view.subscriptions);
}

describe("web UI helpers", () => {
  it("normalizes helper behavior for statuses, filters, and auth modes", () => {
    const view = buildStatusView();
    const tenant = view.tenants[0];
    const tab = view.tabs[1];
    const service = view.services[1];
    const globalBanner = view.banners[0];
    const serviceBanner = view.banners[1];

    expect(statusRank("down")).toBeGreaterThan(statusRank("degraded"));
    expect(statusLabel("maintenance")).toBe("Maintenance");
    expect(colorFor("healthy", view.colors)).toBe("#3BB273");
    expect(colorFor("unknown", [])).toBe("#7A7F87");
    expect(matchesFilter(service, "category:network tag:critical")).toBe(true);
    expect(matchesFilter(service, "service:core-router")).toBe(true);
    expect(matchesFilter(service, "metrics")).toBe(false);
    expect(bannerMatchesScope(globalBanner, tenant, tab, service)).toBe(true);
    expect(bannerMatchesScope(serviceBanner, tenant, tab, service)).toBe(true);
    expect(authModeLabel("oidc")).toBe("OpenID Connect");
    expect(authModeUsesPassword("ldap")).toBe(true);
    expect(authModeUsesPassword("oidc")).toBe(false);
    expect(authModeUsesRedirect("saml")).toBe(true);
    expect(authModeUsesRedirect("local")).toBe(false);
  });

  it("returns the current browser path for SSO round trips", () => {
    window.history.pushState({}, "", "/admin?tenant=primary-site#users");
    expect(currentReturnPath()).toBe("/admin?tenant=primary-site#users");
  });
});

describe("status UI", () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((value) => {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    });
    document.cookie = "ess_theme=; path=/; max-age=0";
    document.documentElement.dataset.theme = "";
    window.history.pushState({}, "", "/");

    mockApi.ssoStartUrl.mockReturnValue("/sso");
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "public",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
  });

  it("renders the current status, scoped banners, incidents, maintenance, and daily summary", async () => {
    mockApi.status.mockResolvedValue(buildStatusView());

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Metrics Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Portal notice")).toBeInTheDocument();
    expect(screen.getByText("Router degraded")).toBeInTheDocument();
    expect(screen.getByText("Metrics rollout")).toBeInTheDocument();
    expect(screen.getByText("Daily summary")).toBeInTheDocument();
    expect(screen.getByText("2026-04-20")).toBeInTheDocument();
    expect(screen.getByText("Prometheus rollout in progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Network" }));

    expect(screen.getByText("Core Router")).toBeInTheDocument();
    expect(screen.queryByText("Metrics Pipeline")).not.toBeInTheDocument();
    expect(screen.getByText(/Investigating transient route instability/)).toBeInTheDocument();
  });

  it("supports local status-page authentication and then renders the snapshot", async () => {
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "local",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
    mockApi.status.mockRejectedValueOnce(new MockApiError("Unauthorized", 401)).mockResolvedValue(buildStatusView());
    mockApi.login.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Status access")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "viewer" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock status view" }));

    await screen.findByText("Metrics Pipeline");
    expect(mockApi.login).toHaveBeenCalledWith({
      mode: "local",
      username: "viewer",
      password: "secret"
    });
  });

  it("shows an error when local status-page authentication fails", async () => {
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "local",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
    mockApi.status.mockRejectedValueOnce(new MockApiError("Unauthorized", 401));
    mockApi.login.mockRejectedValue(new Error("nope"));

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Status access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlock status view" }));

    await screen.findByText("Invalid credentials or status access is not enabled.");
  });

  it("starts a browser redirect flow when the status page uses OIDC", async () => {
    const assignSpy = vi.spyOn(browserRedirect, "assign").mockImplementation(() => void 0);
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "oidc",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
    mockApi.status.mockRejectedValueOnce(new MockApiError("Unauthorized", 401));

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Status access")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with OpenID Connect" }));

    expect(mockApi.ssoStartUrl).toHaveBeenCalledWith("oidc", "status", "/");
    expect(assignSpy).toHaveBeenCalledWith("/sso");
    assignSpy.mockRestore();
  });

  it("renders an unreachable message when the status API fails without an auth challenge", async () => {
    mockApi.status.mockRejectedValue(new Error("offline"));

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("The status service is not reachable.")).toBeInTheDocument();
  });
});

describe("admin UI", () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((value) => {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    });
    document.cookie = "ess_theme=; path=/; max-age=0";
    document.documentElement.dataset.theme = "";
    window.history.pushState({}, "", "/admin");

    mockApi.ssoStartUrl.mockReturnValue("/sso");
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "public",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
  });

  it("renders the admin login panel when no admin session exists", async () => {
    mockApi.me.mockRejectedValue(new MockApiError("Unauthorized", 401));

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Login required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("supports local admin login and loads the authenticated admin console", async () => {
    primeAuthenticatedAdminMocks();
    mockApi.me.mockRejectedValueOnce(new MockApiError("Unauthorized", 401)).mockResolvedValue({ user: { username: "admin", isAdmin: true }, meta: buildMeta() });
    mockApi.login.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Login required")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "change-me" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Authenticated admin session active.")).toBeInTheDocument();
    expect(mockApi.login).toHaveBeenCalledWith({
      mode: "local",
      username: "admin",
      password: "change-me"
    });
  });

  it("starts a browser redirect flow when admin authentication uses OIDC", async () => {
    const assignSpy = vi.spyOn(browserRedirect, "assign").mockImplementation(() => void 0);
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "public",
      adminAuthModes: ["oidc"],
      redirectAuthModes: ["oidc", "oauth", "saml"],
      labels: {
        public: "Public",
        ip: "IP allowlist",
        local: "Static account",
        ldap: "LDAP",
        saml: "SAML",
        oauth: "OAuth2",
        oidc: "OpenID Connect"
      }
    });
    mockApi.me.mockRejectedValue(new MockApiError("Unauthorized", 401));

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Login required")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with OpenID Connect" }));

    expect(mockApi.ssoStartUrl).toHaveBeenCalledWith("oidc", "admin", "/admin");
    expect(assignSpy).toHaveBeenCalledWith("/sso");
    assignSpy.mockRestore();
  });

  it("executes the main admin workflows for connectors, users, notifications, branding, tabs, colors, banners, and logout", async () => {
    const view = buildStatusView();
    primeAuthenticatedAdminMocks(view);
    mockApi.users.mockResolvedValue([
      { id: "user-admin", username: "admin", displayName: "Admin", email: "admin@example.org", authType: "local", isAdmin: true, enabled: true },
      { id: "user-ops", username: "ops", displayName: "Ops", email: "ops@example.org", authType: "ldap", isAdmin: true, enabled: true },
      { id: "user-viewer", username: "viewer", displayName: "Viewer", email: "viewer@example.org", authType: "local", isAdmin: false, enabled: true }
    ]);
    mockApi.createConnector.mockResolvedValue(view.connectors[0]);
    mockApi.updateConnector.mockResolvedValue(view.connectors[0]);
    mockApi.deleteConnector.mockResolvedValue({ ok: true });
    mockApi.createUser.mockResolvedValue({ id: "user-new", username: "newuser", displayName: "New User", email: "new@example.org", authType: "local", isAdmin: false, enabled: true });
    mockApi.promoteUser.mockResolvedValue({ id: "user-ops", username: "ops", displayName: "Ops", email: "ops@example.org", authType: "ldap", isAdmin: true, enabled: true });
    mockApi.demoteUser.mockResolvedValue({ id: "user-ops", username: "ops", displayName: "Ops", email: "ops@example.org", authType: "ldap", isAdmin: false, enabled: true });
    mockApi.createSubscription.mockResolvedValue(view.subscriptions[0]);
    mockApi.deleteSubscription.mockResolvedValue({ ok: true });
    mockApi.updateBranding.mockResolvedValue(view.meta);
    mockApi.createTab.mockResolvedValue(view.tabs[0]);
    mockApi.updateColors.mockResolvedValue(view.colors);
    mockApi.createBanner.mockResolvedValue(view.banners[0]);
    mockApi.logout.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Authenticated admin session active.")).toBeInTheDocument();
    expect(screen.getByText("Prometheus cluster")).toBeInTheDocument();
    expect(screen.getByText("Connectors due: 1 / 1")).toBeInTheDocument();

    const connectorsPanel = screen.getByText("Connectors").closest("article");
    expect(connectorsPanel).not.toBeNull();
    const connectorScope = within(connectorsPanel as HTMLElement);
    fireEvent.change(connectorScope.getByLabelText("Name"), { target: { value: "Webhook intake" } });
    fireEvent.change(connectorScope.getByLabelText("Type"), { target: { value: "webhook" } });
    fireEvent.change(connectorScope.getByLabelText("Poll interval seconds"), { target: { value: "600" } });
    fireEvent.click(connectorScope.getByRole("button", { name: "Create connector" }));
    await waitFor(() => {
      expect(mockApi.createConnector).toHaveBeenCalledWith({
        tenantSlug: "primary-site",
        type: "webhook",
        name: "Webhook intake",
        configJson: "{\n  \"filters\": []\n}",
        authJson: "{\n  \"username\": \"\",\n  \"password\": \"\"\n}",
        enabled: true,
        pollIntervalSeconds: 600
      });
    });

    fireEvent.click(connectorScope.getByRole("button", { name: "Edit" }));
    await waitFor(() => {
      expect(connectorScope.getByRole("button", { name: "Save connector" })).toBeInTheDocument();
    });
    fireEvent.change(connectorScope.getByLabelText("Name"), { target: { value: "Prometheus cluster updated" } });
    fireEvent.click(connectorScope.getByRole("button", { name: "Save connector" }));
    await waitFor(() => {
      expect(mockApi.updateConnector).toHaveBeenCalledWith("connector-prometheus", expect.objectContaining({ name: "Prometheus cluster updated" }));
    });
    fireEvent.click(connectorScope.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockApi.deleteConnector).toHaveBeenCalledWith("connector-prometheus");
    });

    const usersPanel = screen.getByText("Users").closest("article");
    expect(usersPanel).not.toBeNull();
    const usersScope = within(usersPanel as HTMLElement);
    fireEvent.change(usersScope.getByLabelText("Username"), { target: { value: "newuser" } });
    fireEvent.change(usersScope.getByLabelText("Display name"), { target: { value: "New User" } });
    fireEvent.change(usersScope.getByLabelText("Email"), { target: { value: "new@example.org" } });
    fireEvent.change(usersScope.getByLabelText("Password"), { target: { value: "admin-password" } });
    fireEvent.click(usersScope.getByRole("button", { name: "Create user" }));
    await waitFor(() => {
      expect(mockApi.createUser).toHaveBeenCalledWith({
        username: "newuser",
        displayName: "New User",
        email: "new@example.org",
        authType: "local",
        password: "admin-password",
        enabled: true
      });
    });
    fireEvent.click(usersScope.getByRole("button", { name: "Promote" }));
    await waitFor(() => {
      expect(mockApi.promoteUser).toHaveBeenCalledWith("user-viewer");
    });
    fireEvent.click(usersScope.getByRole("button", { name: "Demote" }));
    await waitFor(() => {
      expect(mockApi.demoteUser).toHaveBeenCalledWith("user-ops");
    });

    const notificationsPanel = screen.getByText("Notifications").closest("article");
    expect(notificationsPanel).not.toBeNull();
    const notificationsScope = within(notificationsPanel as HTMLElement);
    fireEvent.change(notificationsScope.getByLabelText("Target"), { target: { value: "alerts@example.org" } });
    fireEvent.change(notificationsScope.getByLabelText("Channel"), { target: { value: "email" } });
    fireEvent.click(notificationsScope.getByRole("button", { name: "Create subscription" }));
    await waitFor(() => {
      expect(mockApi.createSubscription).toHaveBeenCalledWith({
        tenantSlug: "primary-site",
        serviceId: null,
        channelType: "email",
        target: "alerts@example.org",
        enabled: true
      });
    });
    fireEvent.click(notificationsScope.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockApi.deleteSubscription).toHaveBeenCalledWith("subscription-slack");
    });

    const brandingPanel = screen.getByText("Branding").closest("article");
    expect(brandingPanel).not.toBeNull();
    const brandingScope = within(brandingPanel as HTMLElement);
    fireEvent.change(brandingScope.getByLabelText("Application name"), { target: { value: "Service Levels" } });
    fireEvent.click(brandingScope.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(mockApi.updateBranding).toHaveBeenCalledWith(expect.objectContaining({ appName: "Service Levels" }));
    });

    const tabsPanel = screen.getByText("Tabs").closest("article");
    expect(tabsPanel).not.toBeNull();
    const tabsScope = within(tabsPanel as HTMLElement);
    fireEvent.change(tabsScope.getByLabelText("Title"), { target: { value: "Critical" } });
    fireEvent.change(tabsScope.getByLabelText("Filter query"), { target: { value: "tag:critical" } });
    fireEvent.click(tabsScope.getByRole("button", { name: "Create tab" }));
    await waitFor(() => {
      expect(mockApi.createTab).toHaveBeenCalledWith({
        tenantSlug: "primary-site",
        title: "Critical",
        filterQuery: "tag:critical",
        isGlobal: false
      });
    });

    const colorsPanel = screen.getByText("Status colors").closest("article");
    expect(colorsPanel).not.toBeNull();
    const colorsScope = within(colorsPanel as HTMLElement);
    fireEvent.change(colorsScope.getByDisplayValue("#D9A441"), { target: { value: "#FFB400" } });
    fireEvent.click(colorsScope.getByRole("button", { name: "Save colors" }));
    await waitFor(() => {
      expect(mockApi.updateColors).toHaveBeenCalledWith(
        "primary-site",
        expect.arrayContaining([expect.objectContaining({ statusKey: "degraded", colorHex: "#FFB400" })])
      );
    });

    const bannerPanel = screen.getByText("Banner composer").closest("article");
    expect(bannerPanel).not.toBeNull();
    const bannerScope = within(bannerPanel as HTMLElement);
    fireEvent.change(bannerScope.getByLabelText("Title"), { target: { value: "Operator update" } });
    fireEvent.change(bannerScope.getByLabelText("Message"), { target: { value: "Teams are validating routing paths." } });
    fireEvent.click(bannerScope.getByRole("button", { name: "Publish banner" }));
    await waitFor(() => {
      expect(mockApi.createBanner).toHaveBeenCalledWith({
        tenantSlug: "primary-site",
        scopeType: "tenant",
        scopeRef: "primary-site",
        title: "Operator update",
        message: "Teams are validating routing paths.",
        severity: "maintenance"
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await waitFor(() => {
      expect(mockApi.logout).toHaveBeenCalled();
    });
    await screen.findByText("Login required");
  });
});
