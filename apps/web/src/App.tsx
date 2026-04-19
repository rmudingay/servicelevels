import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import { useThemeMode } from "./theme";
import type {
  AdminUser,
  AppMeta,
  AuthMode,
  Banner,
  ColorMapping,
  Incident,
  IntegrationConnector,
  MaintenanceWindow,
  NotificationSubscription,
  ServiceDefinition,
  StatusLevel,
  StatusView,
  TabDefinition,
  Tenant
} from "@service-levels/shared";

export function statusRank(status: StatusLevel): number {
  switch (status) {
    case "healthy":
      return 0;
    case "degraded":
      return 1;
    case "maintenance":
      return 2;
    case "down":
      return 3;
    default:
      return 4;
  }
}

export function bannerMatchesScope(banner: Banner, tenant: Tenant, tab?: TabDefinition, service?: ServiceDefinition): boolean {
  if (!banner.active) {
    return false;
  }
  if (banner.scopeType === "global") {
    return true;
  }
  if (banner.scopeType === "tenant") {
    return banner.scopeRef === tenant.slug || banner.scopeRef === tenant.id || banner.scopeRef === "";
  }
  if (banner.scopeType === "tab") {
    return Boolean(tab) && (banner.scopeRef === tab?.slug || banner.scopeRef === tab?.id || banner.scopeRef === "");
  }
  if (banner.scopeType === "category") {
    return Boolean(service) && banner.scopeRef === service?.category;
  }
  if (banner.scopeType === "service") {
    return Boolean(service) && (banner.scopeRef === service?.slug || banner.scopeRef === service?.id);
  }
  return false;
}

export function matchesFilter(service: ServiceDefinition, filterQuery: string): boolean {
  const query = filterQuery.trim();
  if (!query) {
    return true;
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    const [rawKey, rawValue] = token.split(":");
    const key = rawValue ? rawKey : "text";
    const value = rawValue ?? rawKey;

    switch (key) {
      case "tag":
        return service.tags.includes(value);
      case "category":
        return service.category === value;
      case "topic":
        return service.topic === value;
      case "service":
        return service.slug === value || service.name.toLowerCase().includes(value.toLowerCase());
      case "text":
      default:
        return [service.name, service.category, service.topic, service.slug].some((entry) => entry.toLowerCase().includes(value.toLowerCase()));
    }
  });
}

export function statusLabel(status: StatusLevel): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    case "maintenance":
      return "Maintenance";
    default:
      return "Unknown";
  }
}

export function colorFor(status: StatusLevel, colors: ColorMapping[]): string {
  return colors.find((entry) => entry.statusKey === status)?.colorHex ?? "#7A7F87";
}

export function authModeLabel(mode: AuthMode): string {
  switch (mode) {
    case "public":
      return "Public";
    case "ip":
      return "IP allowlist";
    case "local":
      return "Static account";
    case "ldap":
      return "LDAP";
    case "saml":
      return "SAML";
    case "oauth":
      return "OAuth2";
    case "oidc":
      return "OpenID Connect";
    default:
      return mode;
  }
}

export function authModeUsesPassword(mode: AuthMode): boolean {
  return mode === "local" || mode === "ldap";
}

export function authModeUsesRedirect(mode: AuthMode): boolean {
  return mode === "oauth" || mode === "oidc" || mode === "saml";
}

export function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export const browserRedirect = {
  assign(url: string): void {
    window.location.assign(url);
  }
};

function Shell({
  title,
  subtitle,
  children,
  meta,
  onToggleTheme,
  themeMode
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  meta: { appName: string; logoUrl: string; faviconUrl: string; themeDefault: "light" | "dark" };
  onToggleTheme: () => void;
  themeMode: "light" | "dark";
}) {
  useEffect(() => {
    document.title = `${title} · ${meta.appName}`;
    if (meta.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = meta.faviconUrl;
    }
  }, [meta.appName, meta.faviconUrl, title]);

  return (
    <div className="app-shell">
      <div className="noise" />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">{meta.logoUrl ? <img src={meta.logoUrl} alt="" /> : "SL"}</div>
          <div>
            <div className="eyebrow">{meta.appName}</div>
            <div className="headline">{title}</div>
            <div className="subhead">{subtitle}</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={onToggleTheme}>
            {themeMode === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <NavLink className="ghost-button" to="/">
            Status
          </NavLink>
          <NavLink className="ghost-button" to="/admin">
            Admin
          </NavLink>
        </div>
      </header>
      <main className="page-content">{children}</main>
    </div>
  );
}

export function StatusPage() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [authOptions, setAuthOptions] = useState<{ publicAuthMode: AuthMode; adminAuthModes: AuthMode[]; labels: Record<AuthMode, string> }>({
    publicAuthMode: "public",
    adminAuthModes: [],
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
  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [selectedTabSlug, setSelectedTabSlug] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeMode] = useThemeMode("dark");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loginMode, setLoginMode] = useState<AuthMode>("local");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("change-me");
  const [loginMessage, setLoginMessage] = useState("");

  useEffect(() => {
    void api.authOptions().then(setAuthOptions).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (authOptions.publicAuthMode !== "public" && authOptions.publicAuthMode !== "ip") {
      setLoginMode(authOptions.publicAuthMode);
    }
  }, [authOptions.publicAuthMode]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setNeedsAuth(false);
    void api
      .status(tenantSlug || undefined)
      .then((view) => {
        if (mounted) {
          setStatus(view);
          setLoading(false);
          if (!document.cookie.includes("ess_theme=")) {
            setThemeMode(view.meta.themeDefault);
          }
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setLoading(false);
          if (error instanceof ApiError && error.status === 401) {
            setNeedsAuth(true);
          }
        }
      });
    return () => {
      mounted = false;
    };
  }, [tenantSlug]);

  async function handleStatusLogin(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (authModeUsesRedirect(loginMode)) {
      browserRedirect.assign(api.ssoStartUrl(loginMode as "oidc" | "oauth" | "saml", "status", currentReturnPath()));
      return;
    }
    try {
      await api.login({
        mode: loginMode,
        username: authModeUsesPassword(loginMode) ? username : undefined,
        password: authModeUsesPassword(loginMode) ? password : undefined
      });
      setLoginMessage("Authenticated.");
      setNeedsAuth(false);
      const view = await api.status(tenantSlug || undefined);
      setStatus(view);
      if (!document.cookie.includes("ess_theme=")) {
        setThemeMode(view.meta.themeDefault);
      }
    } catch {
      setLoginMessage("Invalid credentials or status access is not enabled.");
    }
  }

  const currentTenant = useMemo(() => {
    if (!status) {
      return undefined;
    }
    return status.tenants.find((tenant) => tenant.slug === tenantSlug) ?? status.tenants[0];
  }, [status, tenantSlug]);

  useEffect(() => {
    if (!status || status.tabs.length === 0) {
      setSelectedTabSlug("");
      return;
    }
    if (!status.tabs.some((tab) => tab.slug === selectedTabSlug)) {
      setSelectedTabSlug(status.tabs[0].slug);
    }
  }, [status, selectedTabSlug]);

  const selectedTab = useMemo(() => {
    if (!status || status.tabs.length === 0) {
      return undefined;
    }
    return status.tabs.find((tab) => tab.slug === selectedTabSlug) ?? status.tabs[0];
  }, [status, selectedTabSlug]);
  const visibleServices = useMemo(() => {
    if (!status || !selectedTab) {
      return [];
    }
    return [...status.services.filter((service) => matchesFilter(service, selectedTab.filterQuery))].sort((left, right) => {
      const leftStatus = status.snapshot?.services.find((entry) => entry.serviceId === left.id)?.status ?? "unknown";
      const rightStatus = status.snapshot?.services.find((entry) => entry.serviceId === right.id)?.status ?? "unknown";
      return statusRank(rightStatus) - statusRank(leftStatus);
    });
  }, [status, selectedTab]);

  const overallStatus = status?.snapshot?.overallStatus ?? "unknown";
  const activeBanners = useMemo(() => {
    if (!status || !currentTenant) {
      return [];
    }
    return status.banners.filter((banner) => bannerMatchesScope(banner, currentTenant, selectedTab));
  }, [status, currentTenant, selectedTab]);

  if (loading && !status) {
    return (
      <Shell
        title="Status"
        subtitle="Loading current status"
        meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "dark" }}
        onToggleTheme={() => void 0}
        themeMode={themeMode}
      >
        <div className="panel">Loading status snapshot...</div>
      </Shell>
    );
  }

  if (!status) {
    if (needsAuth) {
      return (
        <Shell
          title="Status"
          subtitle="Authentication required"
          meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "dark" }}
          onToggleTheme={() => void 0}
          themeMode={themeMode}
        >
          <section className="panel auth-panel">
            <div className="panel-kicker">Status access</div>
            <form className="form-grid" onSubmit={handleStatusLogin}>
              <label>
                Authentication mode
                <select value={loginMode} onChange={(event) => setLoginMode(event.target.value as AuthMode)}>
                  <option value={authOptions.publicAuthMode}>{authModeLabel(authOptions.publicAuthMode)}</option>
                </select>
              </label>
              {authModeUsesPassword(loginMode) ? (
                <>
                  <label>
                    Username
                    <input value={username} onChange={(event) => setUsername(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                  <button className="primary-button" type="submit">
                    Unlock status view
                  </button>
                </>
              ) : (
                <button className="primary-button" type="submit">
                  Continue with {authModeLabel(loginMode)}
                </button>
              )}
            </form>
            <div className="muted">{loginMessage || `This deployment requires ${authModeLabel(authOptions.publicAuthMode).toLowerCase()} authentication.`}</div>
          </section>
        </Shell>
      );
    }

    return (
      <Shell
        title="Status"
        subtitle="Unable to load status"
        meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "dark" }}
        onToggleTheme={() => void 0}
        themeMode={themeMode}
      >
        <div className="panel">The status service is not reachable.</div>
      </Shell>
    );
  }

  const meta = status.meta;

  return (
    <Shell
    title="Status"
    subtitle={currentTenant ? currentTenant.description : "Multi-tenant service status view"}
    meta={meta}
      onToggleTheme={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
      themeMode={themeMode}
    >
      <section className="hero grid-two">
        <div className="panel panel-hero">
          <div className="panel-kicker">Overall</div>
          <div className="status-ring" style={{ borderColor: colorFor(overallStatus, status.colors) }}>
            <span>{statusLabel(overallStatus)}</span>
          </div>
          <div className="panel-copy">
            {status.snapshot ? `Last collected ${new Date(status.snapshot.collectedAt).toLocaleString()}` : "No snapshot available"}
          </div>
          <div className="tenant-picker">
            <label htmlFor="tenant">Tenant</label>
            <select id="tenant" value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)}>
              <option value="">All tenants</option>
              {status.tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.slug}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="panel">
          <div className="panel-kicker">Banners</div>
          <div className="banner-stack">
            {activeBanners.length === 0 ? (
              <div className="muted">No active banners for this view.</div>
            ) : (
              activeBanners.map((banner) => (
                <article key={banner.id} className={`banner banner-${banner.severity}`}>
                  <div className="banner-title">{banner.title}</div>
                  <div className="banner-message">{banner.message}</div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-kicker">Incidents</div>
          <div className="banner-stack">
            {status.incidents.length === 0 ? (
              <div className="muted">No active incidents for this view.</div>
            ) : (
              status.incidents.map((incident) => (
                <article key={incident.id} className="banner banner-degraded">
                  <div className="banner-title">{incident.title}</div>
                  <div className="banner-message">{incident.description}</div>
                  <div className="muted">
                    {incident.status} · {incident.sourceType} · opened {new Date(incident.openedAt).toLocaleString()}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-kicker">Maintenance</div>
          <div className="banner-stack">
            {status.maintenance.length === 0 ? (
              <div className="muted">No active maintenance windows for this view.</div>
            ) : (
              status.maintenance.map((entry) => (
                <article key={entry.id} className="banner banner-maintenance">
                  <div className="banner-title">{entry.title}</div>
                  <div className="banner-message">{entry.description}</div>
                  <div className="muted">
                    {entry.status} · started {new Date(entry.startsAt).toLocaleString()}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-kicker">Daily summary</div>
        {status.dailySummaries.length === 0 ? (
          <div className="muted">No daily summary available yet.</div>
        ) : (
          <div className="summary-list">
            {status.dailySummaries.slice(0, 7).map((entry) => (
              <article key={`${entry.tenantId}-${entry.day}`} className="summary-row">
                <div className="service-topline">
                  <div>
                    <div className="service-name">{entry.day}</div>
                    <div className="service-meta">{entry.sampleCount} samples recorded</div>
                  </div>
                  <span className="service-status" style={{ background: colorFor(entry.overallStatus, status.colors) }}>
                    {statusLabel(entry.overallStatus)}
                  </span>
                </div>
                <div className="summary-metrics">
                  <span>Healthy {Math.round(entry.secondsByStatus.healthy / 60)}m</span>
                  <span>Maintenance {Math.round(entry.secondsByStatus.maintenance / 60)}m</span>
                  <span>Degraded {Math.round(entry.secondsByStatus.degraded / 60)}m</span>
                  <span>Down {Math.round(entry.secondsByStatus.down / 60)}m</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="tab-strip">
        {status.tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-chip ${tab.id === selectedTab?.id ? "active" : ""}`}
            type="button"
            onClick={() => setSelectedTabSlug(tab.slug)}
          >
            {tab.title}
          </button>
        ))}
      </section>

      <section className="service-grid">
        {visibleServices.map((service) => {
          const serviceStatus = status.snapshot?.services.find((entry) => entry.serviceId === service.id)?.status ?? "unknown";
          const banners = status.banners.filter((banner) => bannerMatchesScope(banner, currentTenant ?? status.tenants[0], selectedTab, service));
          return (
            <article key={service.id} className="service-card">
              <div className="service-topline">
                <div>
                  <div className="service-name">{service.name}</div>
                  <div className="service-meta">
                    {service.category} · {service.topic}
                  </div>
                </div>
                <span className="service-status" style={{ background: colorFor(serviceStatus, status.colors) }}>
                  {statusLabel(serviceStatus)}
                </span>
              </div>
              <div className="service-summary">
                {status.snapshot?.services.find((entry) => entry.serviceId === service.id)?.summary ?? "Awaiting latest snapshot"}
              </div>
              <div className="tag-row">
                {service.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>
              {banners.length > 0 && (
                <div className="inline-banners">
                  {banners.map((banner) => (
                    <div key={banner.id} className="inline-banner">
                      <strong>{banner.title}:</strong> {banner.message}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </Shell>
  );
}

export function AdminPage() {
  const [theme, setThemeMode] = useThemeMode("dark");
  const [status, setStatus] = useState<StatusView | null>(null);
  const [authOptions, setAuthOptions] = useState<{ publicAuthMode: AuthMode; adminAuthModes: AuthMode[]; labels: Record<AuthMode, string> }>({
    publicAuthMode: "public",
    adminAuthModes: ["local"],
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
  const [me, setMe] = useState<{ user: unknown; meta: AppMeta & { adminAuthModes: AuthMode[] } } | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("change-me");
  const [loginMode, setLoginMode] = useState<AuthMode>("local");
  const [message, setMessage] = useState<string>("");
  const [branding, setBranding] = useState({ appName: "", logoUrl: "", faviconUrl: "", themeDefault: "dark" as "light" | "dark" });
  const [colors, setColors] = useState<ColorMapping[]>([]);
  const [connectors, setConnectors] = useState<IntegrationConnector[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [collectionHealth, setCollectionHealth] = useState<{
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
  } | null>(null);
  const [tabs, setTabs] = useState<TabDefinition[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string>("primary-site");
  const [bannerForm, setBannerForm] = useState({
    scopeType: "tenant" as Banner["scopeType"],
    scopeRef: "primary-site",
    title: "",
    message: "",
    severity: "maintenance" as Banner["severity"]
  });
  const [tabForm, setTabForm] = useState({
    title: "",
    filterQuery: "",
    isGlobal: false
  });
  const [userForm, setUserForm] = useState({
    username: "",
    displayName: "",
    email: "",
    authType: "local" as "local" | "ldap" | "sso",
    password: "",
    enabled: true
  });
  const [connectorForm, setConnectorForm] = useState({
    type: "zabbix" as IntegrationConnector["type"],
    name: "",
    configJson: "{\n  \"filters\": []\n}",
    authJson: "{\n  \"username\": \"\",\n  \"password\": \"\"\n}",
    enabled: true,
    pollIntervalSeconds: 300
  });
  const [subscriptionForm, setSubscriptionForm] = useState({
    serviceId: "",
    channelType: "slack" as "slack" | "email",
    target: "",
    enabled: true
  });
  const [editingConnectorId, setEditingConnectorId] = useState<string | null>(null);

  async function refresh(currentSession: { user: unknown; meta: AppMeta & { adminAuthModes: AuthMode[] } } | null = me): Promise<void> {
    const [meta, view, brandingValue, colorValues, tabValues, connectorValues, healthValue, userValues, incidentValues, maintenanceValues, subscriptionValues] = await Promise.all([
      api.meta(),
      api.status(tenantSlug),
      api.branding(),
      api.colors(tenantSlug),
      api.tabs(tenantSlug),
      api.connectors(tenantSlug),
      api.collectionHealth(),
      api.users(),
      api.incidents(tenantSlug),
      api.maintenance(tenantSlug),
      api.subscriptions(tenantSlug)
    ]);
    setStatus(view);
    setBranding(brandingValue);
    setColors(colorValues);
    setTabs(tabValues);
    setConnectors(connectorValues);
    setCollectionHealth(healthValue);
    setUsers(userValues);
    setIncidents(incidentValues);
    setMaintenance(maintenanceValues);
    setSubscriptions(subscriptionValues);
    setMe(currentSession ? { ...currentSession, meta } : currentSession);
  }

  useEffect(() => {
    void api.authOptions().then(setAuthOptions).catch(() => void 0);
    void api
      .me()
      .then(async (current) => {
        setMe(current);
        await refresh(current);
      })
      .catch(() => {
        setMe(null);
      });
  }, [tenantSlug]);

  useEffect(() => {
    if (authOptions.adminAuthModes.length > 0 && !authOptions.adminAuthModes.includes(loginMode)) {
      setLoginMode(authOptions.adminAuthModes[0]);
    }
  }, [authOptions.adminAuthModes, loginMode]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (authModeUsesRedirect(loginMode)) {
      browserRedirect.assign(api.ssoStartUrl(loginMode as "oidc" | "oauth" | "saml", "admin", currentReturnPath()));
      return;
    }
    try {
      await api.login({
        mode: loginMode,
        username: authModeUsesPassword(loginMode) ? username : undefined,
        password: authModeUsesPassword(loginMode) ? password : undefined
      });
      const current = await api.me();
      setMe(current);
      setMessage("Authenticated.");
      await refresh(current);
    } catch {
      setMessage("Invalid credentials.");
    }
  }

  async function handleLogout(): Promise<void> {
    await api.logout();
    setMe(null);
    setMessage("Logged out.");
  }

  async function handleBrandingSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await api.updateBranding(branding);
    setMessage("Branding updated.");
    await refresh();
  }

  async function handleColorSave(): Promise<void> {
    await api.updateColors(tenantSlug, colors);
    setMessage("Color mapping updated.");
    await refresh();
  }

  async function handleBannerCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await api.createBanner({
      tenantSlug,
      scopeType: bannerForm.scopeType,
      scopeRef: bannerForm.scopeRef,
      title: bannerForm.title,
      message: bannerForm.message,
      severity: bannerForm.severity
    });
    setBannerForm((current) => ({ ...current, title: "", message: "" }));
    setMessage("Banner created.");
    await refresh();
  }

  async function handleSubscriptionCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await api.createSubscription({
      tenantSlug,
      serviceId: subscriptionForm.serviceId || null,
      channelType: subscriptionForm.channelType,
      target: subscriptionForm.target,
      enabled: subscriptionForm.enabled
    });
    setSubscriptionForm({ serviceId: "", channelType: "slack", target: "", enabled: true });
    setMessage("Subscription created.");
    await refresh();
  }

  async function handleSubscriptionDelete(id: string): Promise<void> {
    await api.deleteSubscription(id);
    setMessage("Subscription removed.");
    await refresh();
  }

  async function handleTabCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await api.createTab({
      tenantSlug,
      title: tabForm.title,
      filterQuery: tabForm.filterQuery,
      isGlobal: tabForm.isGlobal
    });
    setTabForm({ title: "", filterQuery: "", isGlobal: false });
    setMessage("Tab created.");
    await refresh();
  }

  async function handleUserCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await api.createUser({
      username: userForm.username,
      displayName: userForm.displayName || userForm.username,
      email: userForm.email,
      authType: userForm.authType,
      password: userForm.authType === "local" ? userForm.password : undefined,
      enabled: userForm.enabled
    });
    setUserForm({ username: "", displayName: "", email: "", authType: "local", password: "", enabled: true });
    setMessage("User created.");
    await refresh();
  }

  async function handleUserPromote(id: string): Promise<void> {
    await api.promoteUser(id);
    setMessage("Admin access granted.");
    await refresh();
  }

  async function handleUserDemote(id: string): Promise<void> {
    await api.demoteUser(id);
    setMessage("Admin access revoked.");
    await refresh();
  }

  const currentAdminUsername = useMemo(() => {
    const value = me?.user;
    if (value && typeof value === "object" && "username" in value) {
      return String((value as { username?: unknown }).username ?? "");
    }
    return "";
  }, [me]);

  async function handleConnectorCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingConnectorId) {
      await api.updateConnector(editingConnectorId, {
        type: connectorForm.type,
        name: connectorForm.name,
        configJson: connectorForm.configJson,
        authJson: connectorForm.authJson,
        enabled: connectorForm.enabled,
        pollIntervalSeconds: connectorForm.pollIntervalSeconds
      });
      setMessage("Connector updated.");
    } else {
      await api.createConnector({
        tenantSlug,
        type: connectorForm.type,
        name: connectorForm.name,
        configJson: connectorForm.configJson,
        authJson: connectorForm.authJson,
        enabled: connectorForm.enabled,
        pollIntervalSeconds: connectorForm.pollIntervalSeconds
      });
      setMessage("Connector created.");
    }
    setConnectorForm({
      type: "zabbix",
      name: "",
      configJson: "{\n  \"filters\": []\n}",
      authJson: "{\n  \"username\": \"\",\n  \"password\": \"\"\n}",
      enabled: true,
      pollIntervalSeconds: 300
    });
    setEditingConnectorId(null);
    await refresh();
  }

  async function handleConnectorDelete(id: string): Promise<void> {
    await api.deleteConnector(id);
    setMessage("Connector deleted.");
    if (editingConnectorId === id) {
      setEditingConnectorId(null);
    }
    await refresh();
  }

  async function handleConnectorEdit(connector: IntegrationConnector): Promise<void> {
    setConnectorForm({
      type: connector.type,
      name: connector.name,
      configJson: connector.configJson,
      authJson: connector.authJson,
      enabled: connector.enabled,
      pollIntervalSeconds: connector.pollIntervalSeconds
    });
    setEditingConnectorId(connector.id);
  }

  const authenticated = Boolean(me);

  return (
    <Shell
      title="Admin"
      subtitle="Configuration, branding, banners, and status presentation"
      meta={me?.meta ?? { appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "dark" }}
      onToggleTheme={() => setThemeMode(theme === "dark" ? "light" : "dark")}
      themeMode={theme}
    >
      {!authenticated ? (
        <section className="panel auth-panel">
          <div className="panel-kicker">Login required</div>
          <form className="form-grid" onSubmit={handleLogin}>
            <label>
              Authentication mode
              <select value={loginMode} onChange={(event) => setLoginMode(event.target.value as AuthMode)}>
                {authOptions.adminAuthModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {authModeLabel(mode)}
                  </option>
                ))}
              </select>
            </label>
            {authModeUsesPassword(loginMode) ? (
              <>
                <label>
                  Username
                  <input value={username} onChange={(event) => setUsername(event.target.value)} />
                </label>
                <label>
                  Password
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
                <button className="primary-button" type="submit">
                  Sign in
                </button>
              </>
            ) : (
              <button className="primary-button" type="submit">
                Continue with {authModeLabel(loginMode)}
              </button>
            )}
          </form>
          <div className="muted">Use the bootstrap admin credentials or an enabled remote identity provider.</div>
        </section>
      ) : (
        <>
          <section className="hero grid-two">
            <div className="panel">
              <div className="panel-kicker">Session</div>
              <div className="panel-copy">Authenticated admin session active.</div>
              <button className="ghost-button" type="button" onClick={() => void handleLogout()}>
                Logout
              </button>
              <div className="muted">{message}</div>
            </div>
            <div className="panel">
              <div className="panel-kicker">Tenant</div>
              <label>
                Current tenant
                <select value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)}>
                  {status?.tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.slug}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="admin-grid">
            <article className="panel">
              <div className="panel-kicker">Connectors</div>
              <form className="form-grid" onSubmit={handleConnectorCreate}>
                <label>
                  Type
                  <select value={connectorForm.type} onChange={(event) => setConnectorForm((current) => ({ ...current, type: event.target.value as IntegrationConnector["type"] }))}>
                    <option value="zabbix">Zabbix</option>
                    <option value="prometheus">Prometheus</option>
                    <option value="prtg">PRTG</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>
                <label>
                  Name
                  <input value={connectorForm.name} onChange={(event) => setConnectorForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label>
                  Config JSON
                  <textarea rows={4} value={connectorForm.configJson} onChange={(event) => setConnectorForm((current) => ({ ...current, configJson: event.target.value }))} />
                </label>
                <label>
                  Auth JSON
                  <textarea rows={4} value={connectorForm.authJson} onChange={(event) => setConnectorForm((current) => ({ ...current, authJson: event.target.value }))} />
                </label>
                <label>
                  Poll interval seconds
                  <input
                    type="number"
                    min={60}
                    max={2678400}
                    value={connectorForm.pollIntervalSeconds}
                    onChange={(event) =>
                      setConnectorForm((current) => ({ ...current, pollIntervalSeconds: Number(event.target.value) || current.pollIntervalSeconds }))
                    }
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={connectorForm.enabled}
                    onChange={(event) => setConnectorForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  Enabled
                </label>
                <button className="primary-button" type="submit">
                  {editingConnectorId ? "Save connector" : "Create connector"}
                </button>
              </form>
              <div className="inline-list">
                {connectors.map((connector) => (
                  <div key={connector.id} className="inline-banner">
                    <strong>{connector.name}</strong> {connector.type} · every {connector.pollIntervalSeconds}s
                    <div className="topbar-actions">
                      <button className="ghost-button" type="button" onClick={() => void handleConnectorEdit(connector)}>
                        Edit
                      </button>
                      <button className="ghost-button" type="button" onClick={() => void handleConnectorDelete(connector.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-kicker">Collection health</div>
              <div className="panel-copy">
                Last checked {collectionHealth ? new Date(collectionHealth.generatedAt).toLocaleString() : "not available"}
              </div>
              <div className="inline-list">
                {collectionHealth?.tenants.map((entry) => (
                  <div key={entry.tenant.id} className="inline-banner">
                    <strong>{entry.tenant.name}</strong> · {entry.overallStatus}
                    <div className="muted">
                      Latest snapshot: {entry.latestSnapshotAt ? new Date(entry.latestSnapshotAt).toLocaleString() : "none"}
                    </div>
                    <div className="muted">
                      Connectors due: {entry.connectors.filter((connector) => connector.isDue).length} / {entry.connectors.length}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-kicker">Users</div>
              <form className="form-grid" onSubmit={handleUserCreate}>
                <label>
                  Username
                  <input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} />
                </label>
                <label>
                  Display name
                  <input value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} />
                </label>
                <label>
                  Email
                  <input type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} />
                </label>
                <label>
                  Auth type
                  <select value={userForm.authType} onChange={(event) => setUserForm((current) => ({ ...current, authType: event.target.value as "local" | "ldap" | "sso" }))}>
                    <option value="local">Local</option>
                    <option value="ldap">LDAP</option>
                    <option value="sso">SSO</option>
                  </select>
                </label>
                {userForm.authType === "local" && (
                  <label>
                    Password
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                    />
                  </label>
                )}
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={userForm.enabled}
                    onChange={(event) => setUserForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  Enabled
                </label>
                <button className="primary-button" type="submit">
                  Create user
                </button>
              </form>
              <div className="inline-list">
                {users.map((user) => (
                  <div key={user.id} className="inline-banner">
                    <strong>{user.username}</strong> {user.displayName ? `· ${user.displayName}` : ""}
                    <div className="muted">
                      {user.authType} · {user.isAdmin ? "admin" : "user"} · {user.enabled ? "enabled" : "disabled"}
                    </div>
                    <div className="topbar-actions">
                      {!user.isAdmin && (
                        <button className="ghost-button" type="button" onClick={() => void handleUserPromote(user.id)}>
                          Promote
                        </button>
                      )}
                      {user.isAdmin && user.username !== currentAdminUsername && (
                        <button className="ghost-button" type="button" onClick={() => void handleUserDemote(user.id)}>
                          Demote
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-kicker">Notifications</div>
              <form className="form-grid" onSubmit={handleSubscriptionCreate}>
                <label>
                  Channel
                  <select
                    value={subscriptionForm.channelType}
                    onChange={(event) => setSubscriptionForm((current) => ({ ...current, channelType: event.target.value as "slack" | "email" }))}
                  >
                    <option value="slack">Slack</option>
                    <option value="email">Email</option>
                  </select>
                </label>
                <label>
                  Service filter
                  <select value={subscriptionForm.serviceId} onChange={(event) => setSubscriptionForm((current) => ({ ...current, serviceId: event.target.value }))}>
                    <option value="">All services</option>
                    {(status?.services ?? []).map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target
                  <input
                    value={subscriptionForm.target}
                    onChange={(event) => setSubscriptionForm((current) => ({ ...current, target: event.target.value }))}
                    placeholder={subscriptionForm.channelType === "slack" ? "https://hooks.slack.com/..." : "user@example.org"}
                  />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={subscriptionForm.enabled}
                    onChange={(event) => setSubscriptionForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  Enabled
                </label>
                <button className="primary-button" type="submit">
                  Create subscription
                </button>
              </form>
              <div className="inline-list">
                {subscriptions.length === 0 ? (
                  <div className="muted">No notification subscriptions configured.</div>
                ) : (
                  subscriptions.map((subscription) => (
                    <div key={subscription.id} className="inline-banner">
                      <strong>{subscription.channelType}</strong> {subscription.serviceId ? `· ${subscription.serviceId}` : "· all services"}
                      <div className="muted">{subscription.target}</div>
                      <div className="topbar-actions">
                        <button className="ghost-button" type="button" onClick={() => void handleSubscriptionDelete(subscription.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="panel">
              <div className="panel-kicker">Branding</div>
              <form className="form-grid" onSubmit={handleBrandingSave}>
                <label>
                  Application name
                  <input value={branding.appName} onChange={(event) => setBranding((current) => ({ ...current, appName: event.target.value }))} />
                </label>
                <label>
                  Logo URL
                  <input value={branding.logoUrl} onChange={(event) => setBranding((current) => ({ ...current, logoUrl: event.target.value }))} />
                </label>
                <label>
                  Favicon URL
                  <input value={branding.faviconUrl} onChange={(event) => setBranding((current) => ({ ...current, faviconUrl: event.target.value }))} />
                </label>
                <label>
                  Default theme
                  <select value={branding.themeDefault} onChange={(event) => setBranding((current) => ({ ...current, themeDefault: event.target.value as "light" | "dark" }))}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <button className="primary-button" type="submit">
                  Save branding
                </button>
              </form>
            </article>

            <article className="panel">
              <div className="panel-kicker">Tabs</div>
              <form className="form-grid" onSubmit={handleTabCreate}>
                <label>
                  Title
                  <input value={tabForm.title} onChange={(event) => setTabForm((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label>
                  Filter query
                  <input value={tabForm.filterQuery} onChange={(event) => setTabForm((current) => ({ ...current, filterQuery: event.target.value }))} placeholder="category:network tag:critical" />
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={tabForm.isGlobal}
                    onChange={(event) => setTabForm((current) => ({ ...current, isGlobal: event.target.checked }))}
                  />
                  Global tab
                </label>
                <button className="primary-button" type="submit">
                  Create tab
                </button>
              </form>
              <div className="inline-list">
                {tabs.map((tab) => (
                  <div key={tab.id} className="inline-banner">
                    <strong>{tab.title}</strong> {tab.filterQuery ? `- ${tab.filterQuery}` : "- all services"}
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-kicker">Status colors</div>
              <div className="color-list">
                {colors.map((entry, index) => (
                  <label key={entry.statusKey} className="color-row">
                    <span>{entry.label}</span>
                    <input
                      value={entry.colorHex}
                      onChange={(event) => {
                        const next = [...colors];
                        next[index] = { ...entry, colorHex: event.target.value };
                        setColors(next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <button className="primary-button" type="button" onClick={() => void handleColorSave()}>
                Save colors
              </button>
            </article>

            <article className="panel">
              <div className="panel-kicker">Banner composer</div>
              <form className="form-grid" onSubmit={handleBannerCreate}>
                <label>
                  Scope type
                  <select value={bannerForm.scopeType} onChange={(event) => setBannerForm((current) => ({ ...current, scopeType: event.target.value as Banner["scopeType"] }))}>
                    <option value="tenant">Tenant</option>
                    <option value="tab">Tab</option>
                    <option value="category">Category</option>
                    <option value="service">Service</option>
                    <option value="global">Global</option>
                  </select>
                </label>
                <label>
                  Scope ref
                  <input value={bannerForm.scopeRef} onChange={(event) => setBannerForm((current) => ({ ...current, scopeRef: event.target.value }))} />
                </label>
                <label>
                  Title
                  <input value={bannerForm.title} onChange={(event) => setBannerForm((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label>
                  Message
                  <textarea value={bannerForm.message} onChange={(event) => setBannerForm((current) => ({ ...current, message: event.target.value }))} rows={4} />
                </label>
                <label>
                  Severity
                  <select value={bannerForm.severity} onChange={(event) => setBannerForm((current) => ({ ...current, severity: event.target.value as Banner["severity"] }))}>
                    <option value="maintenance">Maintenance</option>
                    <option value="degraded">Degraded</option>
                    <option value="down">Down</option>
                    <option value="healthy">Healthy</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <button className="primary-button" type="submit">
                  Publish banner
                </button>
              </form>
            </article>
          </section>
        </>
      )}
    </Shell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}
