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
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
  deleteTenant: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
  toggleBanner: vi.fn(),
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
    themeDefault: "light",
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

  it("renders the current status in a Cachet-style public layout", async () => {
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
    expect(screen.getByText("Past Incidents")).toBeInTheDocument();
    expect(screen.getByText("Some systems are experiencing issues")).toBeInTheDocument();
    expect(screen.getByText("Deploying Prometheus rules.")).toBeInTheDocument();
    expect(screen.getAllByText("Core Router").length).toBeGreaterThan(0);
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

    expect(await screen.findByText(/Authenticated admin session active/)).toBeInTheDocument();
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

  it("executes the main admin workflows through modal forms", async () => {
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
    mockApi.updateBanner.mockResolvedValue(view.banners[0]);
    mockApi.deleteBanner.mockResolvedValue({ ok: true });
    mockApi.toggleBanner.mockResolvedValue(view.banners[0]);
    mockApi.createTenant.mockResolvedValue({ id: "tenant-new-site", slug: "new-site", name: "New Site", description: "New logical site", enabled: true });
    mockApi.updateTenant.mockResolvedValue(view.tenants[0]);
    mockApi.deleteTenant.mockResolvedValue({ ok: true });
    mockApi.logout.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Authenticated admin session active/)).toBeInTheDocument();
    expect(screen.getByText("Collection health")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tenants" }));
    fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));
    let dialog = screen.getByRole("dialog");
    let tenantScope = within(dialog);
    fireEvent.change(tenantScope.getByLabelText("Tenant name"), { target: { value: "New Site" } });
    fireEvent.change(tenantScope.getByLabelText("URL slug"), { target: { value: "new-site" } });
    fireEvent.change(tenantScope.getByLabelText("Description"), { target: { value: "New logical site" } });
    fireEvent.click(tenantScope.getByRole("button", { name: "Create tenant" }));
    await waitFor(() => {
      expect(mockApi.createTenant).toHaveBeenCalledWith({
        name: "New Site",
        slug: "new-site",
        description: "New logical site",
        enabled: true
      });
    });
    fireEvent.change(screen.getByLabelText("Current tenant"), { target: { value: "primary-site" } });

    fireEvent.click(screen.getByRole("button", { name: "Connectors" }));
    expect(screen.getByText("Prometheus cluster")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create connector" }));
    dialog = screen.getByRole("dialog");
    let connectorScope = within(dialog);
    fireEvent.change(connectorScope.getByLabelText(/Display name/), { target: { value: "Webhook intake" } });
    fireEvent.change(connectorScope.getByLabelText("Type"), { target: { value: "webhook" } });
    fireEvent.click(connectorScope.getByRole("button", { name: "Create connector" }));
    await waitFor(() => {
      expect(mockApi.createConnector).toHaveBeenCalledWith(expect.objectContaining({
        tenantSlug: "primary-site",
        type: "webhook",
        name: "Webhook intake",
        enabled: true,
        pollIntervalSeconds: 300
      }));
    });

    const connectorRow = screen.getByText("Prometheus cluster").closest(".list-group-item");
    expect(connectorRow).not.toBeNull();
    fireEvent.click(within(connectorRow as HTMLElement).getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog");
    connectorScope = within(dialog);
    fireEvent.change(connectorScope.getByLabelText(/Display name/), { target: { value: "Prometheus cluster updated" } });
    fireEvent.click(connectorScope.getByRole("button", { name: "Save connector" }));
    await waitFor(() => {
      expect(mockApi.updateConnector).toHaveBeenCalledWith("connector-prometheus", expect.objectContaining({ name: "Prometheus cluster updated" }));
    });
    fireEvent.click(within(connectorRow as HTMLElement).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockApi.deleteConnector).toHaveBeenCalledWith("connector-prometheus");
    });

    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    dialog = screen.getByRole("dialog");
    const usersScope = within(dialog);
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
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => {
      expect(mockApi.promoteUser).toHaveBeenCalledWith("user-viewer");
    });
    fireEvent.click(screen.getByRole("button", { name: "Demote" }));
    await waitFor(() => {
      expect(mockApi.demoteUser).toHaveBeenCalledWith("user-ops");
    });

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Create subscription" }));
    dialog = screen.getByRole("dialog");
    const notificationsScope = within(dialog);
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
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockApi.deleteSubscription).toHaveBeenCalledWith("subscription-slack");
    });

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const brandingRow = screen.getByText("Branding").closest(".list-group-item");
    expect(brandingRow).not.toBeNull();
    fireEvent.click(within(brandingRow as HTMLElement).getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog");
    const brandingScope = within(dialog);
    fireEvent.change(brandingScope.getByLabelText("Application name"), { target: { value: "Service Levels" } });
    fireEvent.click(brandingScope.getByRole("button", { name: "Save branding" }));
    await waitFor(() => {
      expect(mockApi.updateBranding).toHaveBeenCalledWith(expect.objectContaining({ appName: "Service Levels" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Create tab" }));
    dialog = screen.getByRole("dialog");
    const tabsScope = within(dialog);
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

    const colorsRow = screen.getByText("Status colors").closest(".list-group-item");
    expect(colorsRow).not.toBeNull();
    fireEvent.click(within(colorsRow as HTMLElement).getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog");
    const colorsScope = within(dialog);
    fireEvent.change(colorsScope.getByDisplayValue("#D9A441"), { target: { value: "#FFB400" } });
    fireEvent.click(colorsScope.getByRole("button", { name: "Save colors" }));
    await waitFor(() => {
      expect(mockApi.updateColors).toHaveBeenCalledWith(
        "primary-site",
        expect.arrayContaining([expect.objectContaining({ statusKey: "degraded", colorHex: "#FFB400" })])
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Banners" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish banner" }));
    dialog = screen.getByRole("dialog");
    let bannerScope = within(dialog);
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

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    dialog = screen.getByRole("dialog");
    bannerScope = within(dialog);
    fireEvent.change(bannerScope.getByLabelText("Message"), { target: { value: "Message updated." } });
    fireEvent.change(bannerScope.getByLabelText("Severity"), { target: { value: "healthy" } });
    fireEvent.click(bannerScope.getByRole("button", { name: "Save banner" }));
    await waitFor(() => {
      expect(mockApi.updateBanner).toHaveBeenCalledWith("banner-global", expect.objectContaining({ message: "Message updated.", severity: "healthy" }));
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Unpublish" })[0]);
    await waitFor(() => {
      expect(mockApi.toggleBanner).toHaveBeenCalledWith("banner-global");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => {
      expect(mockApi.deleteBanner).toHaveBeenCalledWith("banner-global");
    });

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    await waitFor(() => {
      expect(mockApi.logout).toHaveBeenCalled();
    });
    await screen.findByText("Login required");
  });
});
