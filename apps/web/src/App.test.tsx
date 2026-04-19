import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusView } from "@service-levels/shared";
import { AdminPage, StatusPage } from "./App";

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

function buildStatusView(): StatusView {
  return {
    meta: {
      appName: "Service Levels application",
      logoUrl: "",
      faviconUrl: "",
      themeDefault: "dark",
      publicAuthMode: "public",
      adminAuthModes: ["local"]
    },
    tenants: [
      {
        id: "tenant-primary-site",
        slug: "primary-site",
        name: "Primary Site",
        description: "Primary service view",
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
      }
    ],
    connectors: [],
    banners: [],
    incidents: [],
    maintenance: [],
    subscriptions: [],
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
          status: "degraded",
          summary: "Prometheus query latency elevated",
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
          maintenance: 0,
          unknown: 0
        },
        firstCollectedAt: "2026-04-20T00:00:00.000Z",
        lastCollectedAt: "2026-04-20T10:00:00.000Z",
        sampleCount: 3
      }
    ]
  };
}

describe("status UI", () => {
  beforeEach(() => {
    Object.values(mockApi).forEach((value) => {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    });
    mockApi.ssoStartUrl.mockReturnValue("/sso");
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "public",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc"],
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

  it("renders the current status and daily summary", async () => {
    mockApi.status.mockResolvedValue(buildStatusView());

    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Metrics Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Daily summary")).toBeInTheDocument();
    expect(screen.getByText("2026-04-20")).toBeInTheDocument();
    expect(screen.getByText("Prometheus query latency elevated")).toBeInTheDocument();
  });

  it("renders the admin login panel when no admin session exists", async () => {
    mockApi.me.mockRejectedValue(new MockApiError("Unauthorized", 401));
    mockApi.authOptions.mockResolvedValue({
      publicAuthMode: "public",
      adminAuthModes: ["local"],
      redirectAuthModes: ["oidc"],
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

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Login required")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
