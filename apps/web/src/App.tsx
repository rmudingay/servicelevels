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
  PlatformSettings,
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

type StatusBarEntry = {
  key: string;
  day: string;
  status: StatusLevel;
  summary: string;
  firstCollectedAt: string;
  lastCollectedAt: string;
  sampleCount: number;
};

const serviceHistoryLimit = 90;

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "not updated";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "not updated";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function bannerTrendLabel(trend: Banner["severityTrend"]): string {
  switch (trend) {
    case "improved":
      return "improved";
    case "worse":
      return "worse";
    case "unchanged":
      return "unchanged";
    default:
      return "no change recorded";
  }
}

function bannerTrendSymbol(trend: Banner["severityTrend"]): string {
  switch (trend) {
    case "improved":
      return "↑";
    case "worse":
      return "↓";
    case "unchanged":
      return "|";
    default:
      return "•";
  }
}

function summarizeSeconds(secondsByStatus: Record<StatusLevel, number>): string {
  return statusChoices
    .map((statusKey) => {
      const seconds = Math.round(secondsByStatus[statusKey] ?? 0);
      if (seconds <= 0) {
        return "";
      }
      const minutes = Math.round(seconds / 60);
      return minutes > 0 ? `${statusLabel(statusKey)} ${minutes}m` : `${statusLabel(statusKey)} ${seconds}s`;
    })
    .filter(Boolean)
    .join(" · ");
}

function serviceStatusHistory(status: StatusView, service: ServiceDefinition): StatusBarEntry[] {
  const serviceSnapshot = status.snapshot?.services.find((entry) => entry.serviceId === service.id);
  const fromSummaries = status.dailySummaries
    .map((summary) => {
      const serviceSummary = summary.serviceSummaries.find((entry) => entry.serviceId === service.id);
      if (!serviceSummary) {
        return null;
      }
      const durationSummary = summarizeSeconds(serviceSummary.secondsByStatus);
      return {
        key: `${service.id}-${summary.day}`,
        day: summary.day,
        status: serviceSummary.overallStatus,
        summary: [serviceSummary.latestSummary, durationSummary].filter(Boolean).join(" · ") || statusLabel(serviceSummary.overallStatus),
        firstCollectedAt: serviceSummary.firstCollectedAt,
        lastCollectedAt: serviceSummary.lastCollectedAt,
        sampleCount: serviceSummary.sampleCount
      };
    })
    .filter((entry): entry is StatusBarEntry => Boolean(entry))
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-serviceHistoryLimit);

  if (fromSummaries.length > 0) {
    return fromSummaries;
  }

  const observedAt = serviceSnapshot?.lastCheckedAt ?? status.snapshot?.collectedAt ?? new Date().toISOString();
  return [
    {
      key: `${service.id}-current`,
      day: observedAt.slice(0, 10),
      status: serviceSnapshot?.status ?? "unknown",
      summary: serviceSnapshot?.summary ?? "Awaiting collection",
      firstCollectedAt: observedAt,
      lastCollectedAt: observedAt,
      sampleCount: serviceSnapshot ? 1 : 0
    }
  ];
}

function statusBarTitle(entry: StatusBarEntry): string {
  return [
    `${formatDay(entry.day)}: ${statusLabel(entry.status)}`,
    entry.summary,
    `Samples: ${entry.sampleCount}`,
    `Observed: ${new Date(entry.firstCollectedAt).toLocaleString()} - ${new Date(entry.lastCollectedAt).toLocaleString()}`
  ].join("\n");
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

const authModeChoices: AuthMode[] = ["public", "ip", "local", "ldap", "saml", "oauth", "oidc"];
const adminAuthModeChoices: AuthMode[] = ["local", "ldap", "saml", "oauth", "oidc"];

function defaultPlatformSettings(): PlatformSettings {
  return {
    auth: {
      publicAuthMode: "public",
      adminAuthModes: ["local"],
      allowedIpRanges: [],
      ldap: {
        url: "",
        baseDn: "",
        bindDn: "",
        bindPassword: "",
        userFilter: "(uid={username})",
        usernameAttribute: "uid",
        displayNameAttribute: "displayName",
        emailAttribute: "mail"
      },
      remoteAuth: {
        userinfoUrl: "",
        introspectionUrl: "",
        clientId: "",
        clientSecret: "",
        usernameClaim: "preferred_username",
        displayNameClaim: "name",
        emailClaim: "email"
      },
      oidc: {
        issuerUrl: "",
        clientId: "",
        clientSecret: "",
        scopes: ["openid", "profile", "email"],
        usernameClaim: "preferred_username",
        displayNameClaim: "name",
        emailClaim: "email",
        prompt: "",
        useUserInfo: true
      },
      saml: {
        entryPoint: "",
        issuer: "service-levels-application",
        idpCert: "",
        privateKey: "",
        publicCert: "",
        nameIdAttribute: "nameid",
        displayNameAttribute: "displayName",
        emailAttribute: "mail"
      }
    },
    notifications: {
      slackWebhookUrl: "",
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: ""
    }
  };
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

function CachetHeader({
  meta,
  title,
  subtitle
}: {
  meta: Pick<AppMeta, "appName" | "logoUrl">;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="cachet-page-header">
      <div className="cachet-page-brand">
        {meta.logoUrl ? (
          <img className="cachet-page-logo" src={meta.logoUrl} alt={`${meta.appName} logo`} />
        ) : (
          <div className="cachet-page-logo-fallback" aria-hidden="true">
            SL
          </div>
        )}
        <div>
          <div className="cachet-page-title">{title}</div>
          {subtitle && <div className="cachet-page-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="cachet-page-product">{meta.appName}</div>
    </header>
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
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeMode] = useThemeMode("light");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loginMode, setLoginMode] = useState<AuthMode>("local");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("change-me");
  const [loginMessage, setLoginMessage] = useState("");

  useEffect(() => {
    void api.authOptions().then(setAuthOptions).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }
    document.title = `Status · ${status.meta.appName}`;
    if (status.meta.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = status.meta.faviconUrl;
    }
  }, [status]);

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

  const overallStatus = status?.snapshot?.overallStatus ?? "unknown";

  if (loading && !status) {
    return (
      <Shell
        title="Status"
        subtitle="Loading current status"
        meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "light" }}
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
          meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "light" }}
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
        meta={{ appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "light" }}
        onToggleTheme={() => void 0}
        themeMode={themeMode}
      >
        <div className="panel">The status service is not reachable.</div>
      </Shell>
    );
  }

  const meta = status.meta;
  const visibleTabs = status.tabs.filter((tab) => tab.enabled);
  const componentGroups = (visibleTabs.length > 0 ? visibleTabs : [undefined]).map((tab) => {
    const services = status.services.filter((service) => matchesFilter(service, tab?.filterQuery ?? ""));
    const groupStatus = services.reduce<StatusLevel>((current, service) => {
      const serviceStatus = status.snapshot?.services.find((entry) => entry.serviceId === service.id)?.status ?? "unknown";
      return statusRank(serviceStatus) > statusRank(current) ? serviceStatus : current;
    }, services.length === 0 ? "unknown" : "healthy");
    return {
      key: tab?.id ?? "services",
      title: tab?.title ?? "Services",
      services,
      status: groupStatus
    };
  });
  const noticeBanners = status.banners.filter((banner) => banner.active && (!currentTenant || banner.tenantId === currentTenant.id));
  const incidentGroups = status.incidents.reduce<Record<string, Incident[]>>((groups, incident) => {
    const day = incident.openedAt.slice(0, 10);
    groups[day] = [...(groups[day] ?? []), incident];
    return groups;
  }, {});
  const timelineDays = Array.from(new Set([...Object.keys(incidentGroups), ...status.dailySummaries.map((entry) => entry.day)]))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, 7);
  const visibleTimelineDays = timelineDays.length > 0 ? timelineDays : [new Date().toISOString().slice(0, 10)];
  const statusAlertClass = overallStatus === "healthy" ? "alert-success" : overallStatus === "down" ? "alert-danger" : "alert-info";
  const statusAlertMessage = overallStatus === "healthy" ? "All systems are operational" : "Some systems are experiencing issues";
  const displayDay = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric"
    });

  return (
    <div className="cachet-page">
      <div className="container" id="app">
        <CachetHeader meta={meta} title="Service Status" subtitle={currentTenant?.name ?? "All tenants"} />
        <div className="section-messages">
          {noticeBanners.map((banner) => (
            <div key={banner.id} className={`alert alert-${banner.severity === "down" ? "danger" : banner.severity === "healthy" ? "success" : banner.severity === "maintenance" ? "info" : "warning"}`}>
              <strong>{banner.title}</strong>
              <span>{banner.message}</span>
            </div>
          ))}
        </div>

        <div className="section-status">
          <div className={`alert ${statusAlertClass}`}>{statusAlertMessage}</div>
        </div>

        <div className="about-app">
          <h2>About This Site</h2>
          <p>{currentTenant?.description || `Stay up to date with the latest service updates from ${meta.appName}.`}</p>
          <div className="cachet-controls">
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

        <div className="section-components">
          {componentGroups.map((group) => (
            <ul key={group.key} className="list-group components">
              <li className="list-group-item group-name">
                <strong>{group.title}</strong>
                <div className="pull-right">
                  <span className="component-dot" style={{ background: colorFor(group.status, status.colors) }} title={statusLabel(group.status)} />
                </div>
              </li>
              {group.services.map((service) => {
                const serviceSnapshot = status.snapshot?.services.find((entry) => entry.serviceId === service.id);
                const serviceStatus = serviceSnapshot?.status ?? "unknown";
                const history = serviceStatusHistory(status, service);
                return (
                  <li key={`${group.key}-${service.id}`} className={`list-group-item component status-${serviceStatus}`} title={serviceSnapshot?.summary ?? service.topic}>
                    <div className="cachet-component-line">
                      <div className="cachet-component-main">
                        <span className="cachet-component-name">{service.name}</span>
                        {serviceSnapshot?.summary && <span className="cachet-component-summary">{serviceSnapshot.summary}</span>}
                      </div>
                      <div className="status-history-bars" aria-label={`${service.name} status history`}>
                        {history.map((entry) => (
                          <span
                            key={entry.key}
                            className="status-history-bar"
                            style={{ backgroundColor: colorFor(entry.status, status.colors) }}
                            title={statusBarTitle(entry)}
                            aria-label={`${formatDay(entry.day)} ${statusLabel(entry.status)}`}
                            tabIndex={0}
                          />
                        ))}
                      </div>
                      <small className={`text-component-${serviceStatus} cachet-component-state`} style={{ color: colorFor(serviceStatus, status.colors) }}>
                        {statusLabel(serviceStatus)}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>

        <div className="section-scheduled">
          <div className="timeline schedule">
            <div className="panel panel-default">
              <div className="panel-heading">
                <strong>Maintenance</strong>
              </div>
              <div className="list-group">
                {status.maintenance.length === 0 ? (
                  <div className="list-group-item">No active maintenance windows for this view.</div>
                ) : (
                  status.maintenance.map((entry) => (
                    <div key={entry.id} className="list-group-item">
                      <strong>{entry.title}</strong>{" "}
                      <small className="date">{new Date(entry.startsAt).toLocaleString()}</small>
                      <div className="markdown-body">
                        <p>{entry.description}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="section-timeline">
          <h1>Past Incidents</h1>
          {visibleTimelineDays.map((day) => {
            const dayIncidents = incidentGroups[day] ?? [];
            return (
              <div key={day}>
                <h4>{displayDay(day)}</h4>
                <div className="timeline">
                  <div className="content-wrapper">
                    {dayIncidents.length === 0 ? (
                      <div className="panel panel-message incident">
                        <div className="panel-body">
                          <p>No incidents reported</p>
                        </div>
                      </div>
                    ) : (
                      dayIncidents.map((incident) => (
                        <div key={incident.id} className="panel panel-message incident">
                          <div className="panel-heading">
                            <strong>{incident.title}</strong>
                            <br />
                            <small className="date">{new Date(incident.openedAt).toLocaleString()}</small>
                          </div>
                          <div className="panel-body markdown-body">
                            <p>{incident.description}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="footer">
        <div className="container footer-inner">
          <p>Powered by {meta.appName}.</p>
          <ul className="list-inline">
            <li>
              <button className="btn btn-link" type="button" onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}>
                {themeMode === "dark" ? "Light mode" : "Dark mode"}
              </button>
            </li>
            <li>
              <NavLink className="btn btn-link" to="/admin">
                Dashboard
              </NavLink>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

type AdminSection = "overview" | "tenants" | "services" | "banners" | "connectors" | "notifications" | "access" | "identity" | "appearance";
type AdminModal =
  | "tenant"
  | "service"
  | "banner"
  | "connector"
  | "user"
  | "subscription"
  | "branding"
  | "tab"
  | "colors"
  | "auth-settings"
  | "slack-settings"
  | "smtp-settings"
  | null;

const adminSections: Array<{ id: AdminSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tenants", label: "Tenants" },
  { id: "services", label: "Services" },
  { id: "banners", label: "Banners" },
  { id: "connectors", label: "Connectors" },
  { id: "notifications", label: "Notifications" },
  { id: "access", label: "Access" },
  { id: "identity", label: "Identity Provider" },
  { id: "appearance", label: "Appearance" }
];

function ModalFrame({
  title,
  description,
  children,
  onClose
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="admin-modal-backdrop" role="presentation">
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
        <div className="admin-modal-heading">
          <div>
            <h2 id="admin-modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn btn-link" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

const statusChoices: StatusLevel[] = ["healthy", "degraded", "down", "maintenance", "unknown"];

function connectorTemplate(type: IntegrationConnector["type"]): Pick<IntegrationConnector, "configJson" | "authJson" | "pollIntervalSeconds"> {
  switch (type) {
    case "prometheus":
      return {
        pollIntervalSeconds: 300,
        configJson: JSON.stringify({ baseUrl: "https://prometheus.example.org", mode: "mixed", services: [{ ref: "prometheus:metrics", query: "up" }] }, null, 2),
        authJson: JSON.stringify({ bearerToken: "" }, null, 2)
      };
    case "prtg":
      return {
        pollIntervalSeconds: 300,
        configJson: JSON.stringify({ baseUrl: "https://prtg.example.org", mode: "table", services: [{ ref: "prtg:network", sensorId: 1234 }] }, null, 2),
        authJson: JSON.stringify({ apiToken: "", username: "", passhash: "" }, null, 2)
      };
    case "webhook":
      return {
        pollIntervalSeconds: 300,
        configJson: JSON.stringify({ sourceKey: "external-source", secret: "", defaultStatus: "unknown", services: [{ ref: "webhook:service" }] }, null, 2),
        authJson: "{}"
      };
    case "zabbix":
    default:
      return {
        pollIntervalSeconds: 300,
        configJson: JSON.stringify({ baseUrl: "https://zabbix.example.org/api_jsonrpc.php", mode: "api", tags: [], services: [{ ref: "zabbix:service" }], tlsRejectUnauthorized: true }, null, 2),
        authJson: JSON.stringify({ username: "", password: "", token: "" }, null, 2)
      };
  }
}

function connectorHelp(type: IntegrationConnector["type"]): { nameHelp: string; configHelp: string; authHelp: string } {
  if (type === "webhook") {
    return {
      nameHelp:
        "A display label and fallback source match. Inbound posts use /api/v1/webhooks/:tenantSlug/:source; :source matches this name, connector id, or config.sourceKey.",
      configHelp: "Set sourceKey and optional secret. services[].ref should match a service Source ref, slug, name, or id.",
      authHelp: "Webhook auth is normally config.secret, sent as Bearer token, token query parameter, or x-webhook-secret."
    };
  }
  if (type === "prometheus") {
    return {
      nameHelp: "A display label for this Prometheus integration. Put the Prometheus URL in Config JSON baseUrl.",
      configHelp: "Use baseUrl, mode, query/ruleName, labels, and services[].ref mappings. The ref links connector output to a status-page service.",
      authHelp: "Use bearerToken, username/password, or custom headers."
    };
  }
  if (type === "prtg") {
    return {
      nameHelp: "A display label for this PRTG integration. Put the PRTG URL in Config JSON baseUrl.",
      configHelp: "Use baseUrl, mode, and services[].ref mappings with objid/group/device/sensor.",
      authHelp: "Use apiToken, or username plus passhash/password."
    };
  }
  return {
    nameHelp: "A display label for this Zabbix integration. Put the Zabbix API URL in Config JSON baseUrl.",
    configHelp: "Use baseUrl, mode, hostIds, groupIds, tags, severities, services[].ref mappings, and optional caCert/tlsRejectUnauthorized.",
    authHelp: "Use token or username/password."
  };
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
  const [branding, setBranding] = useState({ appName: "", logoUrl: "", faviconUrl: "", themeDefault: "light" as "light" | "dark" });
  const [colors, setColors] = useState<ColorMapping[]>([]);
  const [connectors, setConnectors] = useState<IntegrationConnector[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(defaultPlatformSettings());
  const [authSettingsForm, setAuthSettingsForm] = useState<PlatformSettings["auth"]>(defaultPlatformSettings().auth);
  const [notificationSettingsForm, setNotificationSettingsForm] = useState<PlatformSettings["notifications"]>(defaultPlatformSettings().notifications);
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
        lastErrorMessage: string | null;
        nextDueAt: string | null;
        isDue: boolean;
      }>;
    }>;
  } | null>(null);
  const [tabs, setTabs] = useState<TabDefinition[]>([]);
  const [tenantSlug, setTenantSlug] = useState<string>("primary-site");
  const [activeAdminSection, setActiveAdminSection] = useState<AdminSection>("overview");
  const [adminModal, setAdminModal] = useState<AdminModal>(null);
  const [tenantForm, setTenantForm] = useState({
    name: "",
    slug: "",
    description: "",
    enabled: true
  });
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [serviceForm, setServiceForm] = useState({
    name: "",
    slug: "",
    category: "infrastructure",
    topic: "",
    tags: "",
    sourceType: "zabbix" as ServiceDefinition["sourceType"],
    sourceRef: "",
    enabled: true
  });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [bannerForm, setBannerForm] = useState({
    scopeType: "tenant" as Banner["scopeType"],
    scopeRef: "primary-site",
    title: "",
    message: "",
    severity: "maintenance" as Banner["severity"]
  });
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [tabForm, setTabForm] = useState({
    title: "",
    filterQuery: "",
    isGlobal: false,
    enabled: true
  });
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
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
    configJson: connectorTemplate("zabbix").configJson,
    authJson: connectorTemplate("zabbix").authJson,
    enabled: true,
    pollIntervalSeconds: connectorTemplate("zabbix").pollIntervalSeconds
  });
  const [subscriptionForm, setSubscriptionForm] = useState({
    serviceId: "",
    channelType: "slack" as "slack" | "email",
    target: "",
    enabled: true
  });
  const [editingConnectorId, setEditingConnectorId] = useState<string | null>(null);

  async function refresh(
    currentSession: { user: unknown; meta: AppMeta & { adminAuthModes: AuthMode[] } } | null = me,
    targetTenantSlug = tenantSlug
  ): Promise<void> {
    const [
      meta,
      view,
      brandingValue,
      colorValues,
      tabValues,
      connectorValues,
      healthValue,
      userValues,
      incidentValues,
      maintenanceValues,
      subscriptionValues,
      platformSettingsValue
    ] = await Promise.all([
      api.meta(),
      api.status(targetTenantSlug),
      api.branding(),
      api.colors(targetTenantSlug),
      api.tabs(targetTenantSlug),
      api.connectors(targetTenantSlug),
      api.collectionHealth(),
      api.users(),
      api.incidents(targetTenantSlug),
      api.maintenance(targetTenantSlug),
      api.subscriptions(targetTenantSlug),
      api.platformSettings().catch(() => platformSettings)
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
    setPlatformSettings(platformSettingsValue);
    setAuthSettingsForm(platformSettingsValue.auth);
    setNotificationSettingsForm(platformSettingsValue.notifications);
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

  useEffect(() => {
    if (!editingBannerId && bannerForm.scopeType === "tenant") {
      setBannerForm((current) => ({ ...current, scopeRef: tenantSlug }));
    }
  }, [tenantSlug, editingBannerId, bannerForm.scopeType]);

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
    setAdminModal(null);
    await refresh();
  }

  async function handleColorSave(): Promise<void> {
    await api.updateColors(tenantSlug, colors);
    setMessage("Color mapping updated.");
    setAdminModal(null);
    await refresh();
  }

  function setAuthSetting<K extends keyof PlatformSettings["auth"]>(key: K, value: PlatformSettings["auth"][K]): void {
    setAuthSettingsForm((current) => ({ ...current, [key]: value }));
  }

  function setLdapSetting<K extends keyof PlatformSettings["auth"]["ldap"]>(key: K, value: PlatformSettings["auth"]["ldap"][K]): void {
    setAuthSettingsForm((current) => ({ ...current, ldap: { ...current.ldap, [key]: value } }));
  }

  function setRemoteAuthSetting<K extends keyof PlatformSettings["auth"]["remoteAuth"]>(key: K, value: PlatformSettings["auth"]["remoteAuth"][K]): void {
    setAuthSettingsForm((current) => ({ ...current, remoteAuth: { ...current.remoteAuth, [key]: value } }));
  }

  function setOidcSetting<K extends keyof PlatformSettings["auth"]["oidc"]>(key: K, value: PlatformSettings["auth"]["oidc"][K]): void {
    setAuthSettingsForm((current) => ({ ...current, oidc: { ...current.oidc, [key]: value } }));
  }

  function setSamlSetting<K extends keyof PlatformSettings["auth"]["saml"]>(key: K, value: PlatformSettings["auth"]["saml"][K]): void {
    setAuthSettingsForm((current) => ({ ...current, saml: { ...current.saml, [key]: value } }));
  }

  function setNotificationSetting<K extends keyof PlatformSettings["notifications"]>(
    key: K,
    value: PlatformSettings["notifications"][K]
  ): void {
    setNotificationSettingsForm((current) => ({ ...current, [key]: value }));
  }

  function toggleAdminAuthMode(mode: AuthMode): void {
    setAuthSettingsForm((current) => ({
      ...current,
      adminAuthModes: current.adminAuthModes.includes(mode)
        ? current.adminAuthModes.filter((entry) => entry !== mode)
        : [...current.adminAuthModes, mode]
    }));
  }

  async function handleAuthSettingsSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (authSettingsForm.adminAuthModes.length === 0) {
      setMessage("Select at least one admin authentication mode.");
      return;
    }
    const updated = await api.updatePlatformSettings({
      ...platformSettings,
      auth: authSettingsForm
    });
    setPlatformSettings(updated);
    setAuthSettingsForm(updated.auth);
    setAuthOptions(await api.authOptions());
    setMessage("Authentication settings updated.");
    setAdminModal(null);
    await refresh(me, tenantSlug);
  }

  async function handleNotificationSettingsSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const updated = await api.updatePlatformSettings({
      ...platformSettings,
      notifications: notificationSettingsForm
    });
    setPlatformSettings(updated);
    setNotificationSettingsForm(updated.notifications);
    setMessage("Notification delivery settings updated.");
    setAdminModal(null);
    await refresh(me, tenantSlug);
  }

  async function handleTenantSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingTenantId) {
      const updated = await api.updateTenant(editingTenantId, tenantForm);
      setMessage("Tenant updated.");
      if (updated) {
        setTenantSlug(updated.slug);
        await refresh(me, updated.slug);
      } else {
        await refresh();
      }
    } else {
      const created = await api.createTenant(tenantForm);
      setTenantSlug(created.slug);
      setMessage("Tenant created.");
      await refresh(me, created.slug);
    }
    setTenantForm({ name: "", slug: "", description: "", enabled: true });
    setEditingTenantId(null);
    setAdminModal(null);
  }

  async function handleTenantDelete(tenant: Tenant): Promise<void> {
    const nextTenant = status?.tenants.find((entry) => entry.id !== tenant.id);
    await api.deleteTenant(tenant.id);
    const nextSlug = nextTenant?.slug ?? tenantSlug;
    setTenantSlug(nextSlug);
    setMessage("Tenant deleted.");
    await refresh(me, nextSlug);
  }

  function handleTenantEdit(tenant: Tenant): void {
    setTenantForm({
      name: tenant.name,
      slug: tenant.slug,
      description: tenant.description,
      enabled: tenant.enabled
    });
    setEditingTenantId(tenant.id);
    setActiveAdminSection("tenants");
    setAdminModal("tenant");
  }

  function resetServiceForm(): void {
    setServiceForm({
      name: "",
      slug: "",
      category: "infrastructure",
      topic: "",
      tags: "",
      sourceType: "zabbix",
      sourceRef: "",
      enabled: true
    });
    setEditingServiceId(null);
  }

  async function handleServiceSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const payload = {
      name: serviceForm.name,
      slug: serviceForm.slug,
      category: serviceForm.category,
      topic: serviceForm.topic,
      tags: serviceForm.tags.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean),
      sourceType: serviceForm.sourceType,
      sourceRef: serviceForm.sourceRef,
      enabled: serviceForm.enabled
    };
    if (editingServiceId) {
      await api.updateService(editingServiceId, payload);
      setMessage("Service updated.");
    } else {
      await api.createService({
        tenantSlug,
        ...payload
      });
      setMessage("Service created.");
    }
    resetServiceForm();
    setAdminModal(null);
    await refresh();
  }

  function handleServiceEdit(service: ServiceDefinition): void {
    setServiceForm({
      name: service.name,
      slug: service.slug,
      category: service.category,
      topic: service.topic,
      tags: service.tags.join(", "),
      sourceType: service.sourceType,
      sourceRef: service.sourceRef,
      enabled: service.enabled
    });
    setEditingServiceId(service.id);
    setActiveAdminSection("services");
    setAdminModal("service");
  }

  async function handleServiceDelete(id: string): Promise<void> {
    await api.deleteService(id);
    if (editingServiceId === id) {
      resetServiceForm();
    }
    setMessage("Service deleted.");
    await refresh();
  }

  async function handleBannerSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingBannerId) {
      await api.updateBanner(editingBannerId, bannerForm);
      setMessage("Banner updated.");
    } else {
      await api.createBanner({
        tenantSlug,
        scopeType: bannerForm.scopeType,
        scopeRef: bannerForm.scopeRef,
        title: bannerForm.title,
        message: bannerForm.message,
        severity: bannerForm.severity
      });
      setMessage("Banner published.");
    }
    setBannerForm((current) => ({ ...current, title: "", message: "" }));
    setEditingBannerId(null);
    setAdminModal(null);
    await refresh();
  }

  function handleBannerEdit(banner: Banner): void {
    setBannerForm({
      scopeType: banner.scopeType,
      scopeRef: banner.scopeRef,
      title: banner.title,
      message: banner.message,
      severity: banner.severity
    });
    setEditingBannerId(banner.id);
    setActiveAdminSection("banners");
    setAdminModal("banner");
  }

  async function handleBannerToggle(id: string): Promise<void> {
    await api.toggleBanner(id);
    setMessage("Banner visibility updated.");
    await refresh();
  }

  async function handleBannerDelete(id: string): Promise<void> {
    await api.deleteBanner(id);
    if (editingBannerId === id) {
      setEditingBannerId(null);
      setBannerForm((current) => ({ ...current, title: "", message: "" }));
    }
    setMessage("Banner deleted.");
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
    setAdminModal(null);
    await refresh();
  }

  async function handleSubscriptionDelete(id: string): Promise<void> {
    await api.deleteSubscription(id);
    setMessage("Subscription removed.");
    await refresh();
  }

  async function handleTabSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (editingTabId) {
      await api.updateTab(editingTabId, {
        title: tabForm.title,
        filterQuery: tabForm.filterQuery,
        isGlobal: tabForm.isGlobal,
        enabled: tabForm.enabled
      });
      setMessage("Tab updated.");
    } else {
      await api.createTab({
        tenantSlug,
        title: tabForm.title,
        filterQuery: tabForm.filterQuery,
        isGlobal: tabForm.isGlobal
      });
      setMessage("Tab created.");
    }
    setTabForm({ title: "", filterQuery: "", isGlobal: false, enabled: true });
    setEditingTabId(null);
    setAdminModal(null);
    await refresh();
  }

  function handleTabEdit(tab: TabDefinition): void {
    setTabForm({
      title: tab.title,
      filterQuery: tab.filterQuery,
      isGlobal: tab.isGlobal,
      enabled: tab.enabled
    });
    setEditingTabId(tab.id);
    setActiveAdminSection("appearance");
    setAdminModal("tab");
  }

  async function handleTabDelete(tab: TabDefinition): Promise<void> {
    await api.deleteTab(tab.id);
    if (editingTabId === tab.id) {
      setEditingTabId(null);
      setTabForm({ title: "", filterQuery: "", isGlobal: false, enabled: true });
    }
    setMessage("Tab deleted.");
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
    setAdminModal(null);
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
  const currentTenant = status?.tenants.find((tenant) => tenant.slug === tenantSlug) ?? status?.tenants[0];
  const connectorFormHelp = connectorHelp(connectorForm.type);
  const activeBanners = status?.banners.filter((banner) => banner.active) ?? [];
  const inactiveBanners = status?.banners.filter((banner) => !banner.active) ?? [];

  function resetConnectorForm(): void {
    const template = connectorTemplate("zabbix");
    setConnectorForm({
      type: "zabbix",
      name: "",
      configJson: template.configJson,
      authJson: template.authJson,
      enabled: true,
      pollIntervalSeconds: template.pollIntervalSeconds
    });
    setEditingConnectorId(null);
  }

  function handleConnectorTypeChange(type: IntegrationConnector["type"]): void {
    const template = connectorTemplate(type);
    setConnectorForm((current) => ({
      ...current,
      type,
      configJson: template.configJson,
      authJson: template.authJson,
      pollIntervalSeconds: type === "webhook" ? template.pollIntervalSeconds : current.pollIntervalSeconds || template.pollIntervalSeconds
    }));
  }

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
    resetConnectorForm();
    setAdminModal(null);
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
    setActiveAdminSection("connectors");
    setAdminModal("connector");
  }

  function closeAdminModal(): void {
    setAdminModal(null);
    setEditingTenantId(null);
    setTenantForm({ name: "", slug: "", description: "", enabled: true });
    resetServiceForm();
    setEditingBannerId(null);
    setBannerForm({ scopeType: "tenant", scopeRef: tenantSlug, title: "", message: "", severity: "maintenance" });
    resetConnectorForm();
    setEditingTabId(null);
    setTabForm({ title: "", filterQuery: "", isGlobal: false, enabled: true });
  }

  function openTenantCreate(): void {
    setTenantForm({ name: "", slug: "", description: "", enabled: true });
    setEditingTenantId(null);
    setActiveAdminSection("tenants");
    setAdminModal("tenant");
  }

  function openServiceCreate(): void {
    resetServiceForm();
    setActiveAdminSection("services");
    setAdminModal("service");
  }

  function openBannerCreate(): void {
    setBannerForm({ scopeType: "tenant", scopeRef: tenantSlug, title: "", message: "", severity: "maintenance" });
    setEditingBannerId(null);
    setActiveAdminSection("banners");
    setAdminModal("banner");
  }

  function openConnectorCreate(): void {
    resetConnectorForm();
    setActiveAdminSection("connectors");
    setAdminModal("connector");
  }

  function openUserCreate(): void {
    setUserForm({ username: "", displayName: "", email: "", authType: "local", password: "", enabled: true });
    setActiveAdminSection("access");
    setAdminModal("user");
  }

  function openSubscriptionCreate(): void {
    setSubscriptionForm({ serviceId: "", channelType: "slack", target: "", enabled: true });
    setActiveAdminSection("notifications");
    setAdminModal("subscription");
  }

  function openAuthSettings(): void {
    setAuthSettingsForm(platformSettings.auth);
    setActiveAdminSection("access");
    setAdminModal("auth-settings");
  }

  function openIdentityProviderSettings(): void {
    setAuthSettingsForm(platformSettings.auth);
    setActiveAdminSection("identity");
    setAdminModal("auth-settings");
  }

  function openSlackSettings(): void {
    setNotificationSettingsForm(platformSettings.notifications);
    setActiveAdminSection("notifications");
    setAdminModal("slack-settings");
  }

  function openSmtpSettings(): void {
    setNotificationSettingsForm(platformSettings.notifications);
    setActiveAdminSection("notifications");
    setAdminModal("smtp-settings");
  }

  function openTabCreate(): void {
    setTabForm({ title: "", filterQuery: "", isGlobal: false, enabled: true });
    setEditingTabId(null);
    setActiveAdminSection("appearance");
    setAdminModal("tab");
  }

  const authenticated = Boolean(me);
  const adminMeta = me?.meta ?? { appName: "Service Levels application", logoUrl: "", faviconUrl: "", themeDefault: "light" as const };

  return (
    <div className="cachet-page cachet-admin-page">
      <div className="container" id="admin-app">
        <CachetHeader meta={adminMeta} title="Admin Dashboard" subtitle="Control plane" />
        <div className="section-status">
          <div className={`alert ${authenticated ? "alert-success" : "alert-info"}`}>{authenticated ? "Authenticated admin session active" : "Admin authentication required"}</div>
        </div>

        <div className="about-app">
          <h2>Admin Dashboard</h2>
          <p>Configure tenants, service mappings, monitoring connectors, banners, notifications, access, and presentation for {adminMeta.appName}.</p>
          {authenticated && (
            <div className="cachet-admin-toolbar">
              <div className="cachet-controls">
                <label htmlFor="admin-tenant">Current tenant</label>
                <select id="admin-tenant" value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)}>
                  {status?.tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.slug}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-link" type="button" onClick={() => void handleLogout()}>
                Logout
              </button>
            </div>
          )}
        </div>

        {!authenticated ? (
          <div className="admin-modal-backdrop admin-modal-backdrop-static" role="presentation">
            <section className="admin-modal admin-login-panel" role="dialog" aria-modal="true" aria-labelledby="admin-login-title">
              <div className="admin-modal-heading">
                <div>
                  <h2 id="admin-login-title">Login required</h2>
                  <p>Use the bootstrap admin credentials or an enabled remote identity provider.</p>
                </div>
              </div>
              <form className="cachet-form" onSubmit={handleLogin}>
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
                    <button className="btn btn-success" type="submit">
                      Sign in
                    </button>
                  </>
                ) : (
                  <button className="btn btn-success" type="submit">
                    Continue with {authModeLabel(loginMode)}
                  </button>
                )}
              </form>
              {message && <p className="cachet-help-text">{message}</p>}
            </section>
          </div>
        ) : (
          <>
            {message && (
              <div className="section-messages">
                <div className="alert alert-info">{message}</div>
              </div>
            )}

            <div className="section-components admin-sections">
              <ul className="list-group components">
                <li className="list-group-item group-name">
                  <strong>Admin sections</strong>
                </li>
                {adminSections.map((section) => (
                  <li key={section.id} className={`list-group-item component ${activeAdminSection === section.id ? "active" : ""}`}>
                    <button className="cachet-admin-section-button" type="button" onClick={() => setActiveAdminSection(section.id)}>
                      {section.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {activeAdminSection === "overview" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading">
                    <strong>Selected tenant</strong>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>{currentTenant?.name ?? "No tenant selected"}</strong>
                      <div className="cachet-row-meta">{currentTenant?.description || "No description"}</div>
                    </div>
                    <div className="list-group-item">
                      <div className="cachet-stat-list">
                        <div className="cachet-stat-row">
                          <span>Tenants</span>
                          <strong>{status?.tenants.length ?? 0}</strong>
                        </div>
                        <div className="cachet-stat-row">
                          <span>Services</span>
                          <strong>{status?.services.length ?? 0}</strong>
                        </div>
                        <div className="cachet-stat-row">
                          <span>Connectors</span>
                          <strong>{connectors.length}</strong>
                        </div>
                        <div className="cachet-stat-row">
                          <span>Active banners</span>
                          <strong>{activeBanners.length}</strong>
                        </div>
                        <div className="cachet-stat-row">
                          <span>Inactive banners</span>
                          <strong>{inactiveBanners.length}</strong>
                        </div>
                        <div className="cachet-stat-row">
                          <span>Notification targets</span>
                          <strong>{subscriptions.length}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel panel-default">
                  <div className="panel-heading">
                    <strong>Collection health</strong>
                  </div>
                  <div className="list-group">
                    {collectionHealth?.tenants.map((entry) => (
                      <div key={entry.tenant.id} className="list-group-item">
                        <strong>{entry.tenant.name}</strong>
                        <div className="pull-right">{entry.overallStatus}</div>
                        <div className="cachet-row-meta">
                          Latest snapshot: {entry.latestSnapshotAt ? new Date(entry.latestSnapshotAt).toLocaleString() : "none"}
                        </div>
                        <div className="cachet-row-meta">
                          Connectors due: {entry.connectors.filter((connector) => connector.isDue).length} / {entry.connectors.length}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "tenants" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Tenants</strong>
                    <button className="btn btn-success" type="button" onClick={openTenantCreate}>
                      Create tenant
                    </button>
                  </div>
                  <div className="list-group">
                    {status?.tenants.map((tenant) => (
                      <div key={tenant.id} className="list-group-item">
                        <strong>{tenant.name}</strong> <span className="cachet-row-meta">{tenant.slug} · {tenant.enabled ? "enabled" : "disabled"}</span>
                        <div className="pull-right cachet-row-actions">
                          <button className="btn btn-link" type="button" onClick={() => handleTenantEdit(tenant)}>
                            Edit
                          </button>
                          <button className="btn btn-link" type="button" disabled={(status?.tenants.length ?? 0) <= 1} onClick={() => void handleTenantDelete(tenant)}>
                            Delete
                          </button>
                        </div>
                        <div className="cachet-row-meta">{tenant.description || "No description"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "services" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Services</strong>
                    <button className="btn btn-success" type="button" onClick={openServiceCreate}>
                      Create service
                    </button>
                  </div>
                  <div className="list-group">
                    {(status?.services ?? []).length === 0 ? (
                      <div className="list-group-item">No services configured for this tenant.</div>
                    ) : (
                      (status?.services ?? []).map((service) => (
                        <div key={service.id} className="list-group-item">
                          <strong>{service.name}</strong>{" "}
                          <span className="cachet-row-meta">
                            {service.sourceType} · {service.sourceRef || service.slug} · {service.enabled ? "enabled" : "disabled"}
                          </span>
                          <div className="pull-right cachet-row-actions">
                            <button className="btn btn-link" type="button" onClick={() => handleServiceEdit(service)}>
                              Edit
                            </button>
                            <button className="btn btn-link" type="button" onClick={() => void handleServiceDelete(service.id)}>
                              Delete
                            </button>
                          </div>
                          <div className="cachet-row-meta">
                            category:{service.category || "none"} · topic:{service.topic || "none"}
                            {service.tags.length > 0 ? ` · tags:${service.tags.join(", ")}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <p className="cachet-help-text">
                  Tabs use filters like category:infrastructure or tag:network. Connector services[].ref should match the service Source ref to place monitoring output under the intended tab.
                </p>
              </div>
            )}

            {activeAdminSection === "connectors" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Connectors</strong>
                    <button className="btn btn-success" type="button" onClick={openConnectorCreate}>
                      Create connector
                    </button>
                  </div>
                  <div className="list-group">
                    {connectors.map((connector) => (
                      <div key={connector.id} className="list-group-item">
                        <strong>{connector.name}</strong> <span className="cachet-row-meta">{connector.type} · {connector.type === "webhook" ? "inbound" : `every ${connector.pollIntervalSeconds}s`}</span>
                        <div className="pull-right cachet-row-actions">
                          <button className="btn btn-link" type="button" onClick={() => void handleConnectorEdit(connector)}>
                            Edit
                          </button>
                          <button className="btn btn-link" type="button" onClick={() => void handleConnectorDelete(connector.id)}>
                            Delete
                          </button>
                        </div>
                        <div className="cachet-row-meta">
                          {connector.enabled ? "enabled" : "disabled"} ·{" "}
                          {connector.lastSuccessAt ? `last success ${new Date(connector.lastSuccessAt).toLocaleString()}` : connector.lastErrorAt ? `last error ${new Date(connector.lastErrorAt).toLocaleString()}` : "not collected"}
                        </div>
                        {connector.lastErrorMessage && <div className="cachet-row-meta connector-error-message">{connector.lastErrorMessage}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "banners" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Published banners</strong>
                    <button className="btn btn-success" type="button" onClick={openBannerCreate}>
                      Publish banner
                    </button>
                  </div>
                  <div className="list-group">
                    {(status?.banners ?? []).map((banner) => (
                      <div key={banner.id} className="list-group-item">
                        <strong>{banner.title}</strong>{" "}
                        <span className="cachet-row-meta">
                          {statusLabel(banner.severity)} · {banner.active ? "active" : "inactive"} · updated {formatDateTime(banner.updatedAt)}
                        </span>
                        <div className="pull-right cachet-row-actions">
                          <button className="btn btn-link" type="button" onClick={() => handleBannerEdit(banner)}>
                            Edit
                          </button>
                          <button className="btn btn-link" type="button" onClick={() => void handleBannerToggle(banner.id)}>
                            {banner.active ? "Unpublish" : "Publish"}
                          </button>
                          <button className="btn btn-link" type="button" onClick={() => void handleBannerDelete(banner.id)}>
                            Delete
                          </button>
                        </div>
                        <div className="cachet-row-meta">
                          {banner.scopeType}
                          {banner.scopeRef ? `:${banner.scopeRef}` : ""} · {banner.message}
                        </div>
                        <div className={`banner-trend banner-trend-${banner.severityTrend ?? "none"}`} title={`Severity trend: ${bannerTrendLabel(banner.severityTrend)}`}>
                          <span aria-hidden="true">{bannerTrendSymbol(banner.severityTrend)}</span>
                          <span>{bannerTrendLabel(banner.severityTrend)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "notifications" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>SMTP server</strong>
                    <button className="btn btn-link" type="button" onClick={openSmtpSettings}>
                      Edit
                    </button>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>Email delivery</strong>
                      <div className="cachet-row-meta">
                        {platformSettings.notifications.smtpHost
                          ? `${platformSettings.notifications.smtpHost}:${platformSettings.notifications.smtpPort} · from ${platformSettings.notifications.smtpFrom || "not set"}`
                          : "Not configured"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Global Slack webhook</strong>
                    <button className="btn btn-link" type="button" onClick={openSlackSettings}>
                      Edit
                    </button>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>Slack delivery</strong>
                      <div className="cachet-row-meta">{platformSettings.notifications.slackWebhookUrl ? "Configured" : "Not configured"}</div>
                    </div>
                  </div>
                </div>

                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Notifications</strong>
                    <button className="btn btn-success" type="button" onClick={openSubscriptionCreate}>
                      Create subscription
                    </button>
                  </div>
                  <div className="list-group">
                    {subscriptions.length === 0 ? (
                      <div className="list-group-item">No notification subscriptions configured.</div>
                    ) : (
                      subscriptions.map((subscription) => (
                        <div key={subscription.id} className="list-group-item">
                          <strong>{subscription.channelType}</strong> <span className="cachet-row-meta">{subscription.serviceId ? `· ${subscription.serviceId}` : "· all services"}</span>
                          <div className="pull-right">
                            <button className="btn btn-link" type="button" onClick={() => void handleSubscriptionDelete(subscription.id)}>
                              Delete
                            </button>
                          </div>
                          <div className="cachet-row-meta">{subscription.target}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "access" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Authentication settings</strong>
                    <button className="btn btn-link" type="button" onClick={openAuthSettings}>
                      Edit
                    </button>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>Status page access</strong>
                      <div className="cachet-row-meta">{authModeLabel(platformSettings.auth.publicAuthMode)}</div>
                    </div>
                    <div className="list-group-item">
                      <strong>Admin sign-in modes</strong>
                      <div className="cachet-row-meta">{platformSettings.auth.adminAuthModes.map(authModeLabel).join(", ") || "No admin modes configured"}</div>
                    </div>
                    <div className="list-group-item">
                      <strong>Identity provider</strong>
                      <div className="cachet-row-meta">
                        {platformSettings.auth.oidc.issuerUrl
                          ? `OIDC ${platformSettings.auth.oidc.issuerUrl}`
                          : platformSettings.auth.saml.entryPoint
                            ? `SAML ${platformSettings.auth.saml.entryPoint}`
                            : platformSettings.auth.ldap.url
                              ? `LDAP ${platformSettings.auth.ldap.url}`
                              : "Not configured"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Users</strong>
                    <button className="btn btn-success" type="button" onClick={openUserCreate}>
                      Create user
                    </button>
                  </div>
                  <div className="list-group">
                    {users.map((user) => (
                      <div key={user.id} className="list-group-item">
                        <strong>{user.username}</strong> {user.displayName ? <span className="cachet-row-meta">· {user.displayName}</span> : null}
                        <div className="pull-right cachet-row-actions">
                          {!user.isAdmin && (
                            <button className="btn btn-link" type="button" onClick={() => void handleUserPromote(user.id)}>
                              Promote
                            </button>
                          )}
                          {user.isAdmin && user.username !== currentAdminUsername && (
                            <button className="btn btn-link" type="button" onClick={() => void handleUserDemote(user.id)}>
                              Demote
                            </button>
                          )}
                        </div>
                        <div className="cachet-row-meta">
                          {user.authType} · {user.isAdmin ? "admin" : "user"} · {user.enabled ? "enabled" : "disabled"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "identity" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading cachet-panel-actions">
                    <strong>Identity provider configuration</strong>
                    <button className="btn btn-success" type="button" onClick={openIdentityProviderSettings}>
                      Configure IdP
                    </button>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>OpenID Connect / OAuth2</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={openIdentityProviderSettings}>
                          Edit
                        </button>
                      </div>
                      <div className="cachet-row-meta">
                        {platformSettings.auth.oidc.issuerUrl
                          ? `${platformSettings.auth.oidc.issuerUrl} · client ${platformSettings.auth.oidc.clientId || "not set"}`
                          : platformSettings.auth.remoteAuth.userinfoUrl || platformSettings.auth.remoteAuth.introspectionUrl
                            ? `OAuth2 token endpoints configured · client ${platformSettings.auth.remoteAuth.clientId || "not set"}`
                            : "Not configured"}
                      </div>
                    </div>
                    <div className="list-group-item">
                      <strong>SAML 2.0</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={openIdentityProviderSettings}>
                          Edit
                        </button>
                      </div>
                      <div className="cachet-row-meta">
                        {platformSettings.auth.saml.entryPoint
                          ? `${platformSettings.auth.saml.entryPoint} · issuer ${platformSettings.auth.saml.issuer || "not set"}`
                          : "Not configured"}
                      </div>
                    </div>
                    <div className="list-group-item">
                      <strong>LDAP directory</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={openIdentityProviderSettings}>
                          Edit
                        </button>
                      </div>
                      <div className="cachet-row-meta">
                        {platformSettings.auth.ldap.url
                          ? `${platformSettings.auth.ldap.url} · base ${platformSettings.auth.ldap.baseDn || "not set"}`
                          : "Not configured"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel panel-default">
                  <div className="panel-heading">
                    <strong>Provider URLs</strong>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>OIDC callback</strong>
                      <div className="cachet-row-meta">/api/v1/auth/sso/oidc/callback</div>
                    </div>
                    <div className="list-group-item">
                      <strong>SAML callback</strong>
                      <div className="cachet-row-meta">/api/v1/auth/sso/saml/callback</div>
                    </div>
                    <div className="list-group-item">
                      <strong>SAML metadata</strong>
                      <div className="cachet-row-meta">/api/v1/auth/sso/saml/metadata</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeAdminSection === "appearance" && (
              <div className="section-scheduled">
                <div className="panel panel-default">
                  <div className="panel-heading">
                    <strong>Appearance</strong>
                  </div>
                  <div className="list-group">
                    <div className="list-group-item">
                      <strong>Branding</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={() => setAdminModal("branding")}>
                          Edit
                        </button>
                      </div>
                      <div className="cachet-row-meta">{branding.appName || adminMeta.appName}</div>
                    </div>
                    <div className="list-group-item">
                      <strong>Tabs</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={openTabCreate}>
                          Create tab
                        </button>
                      </div>
                      <div className="cachet-row-meta">
                        Tabs organize status rows using filter queries. Example: category:infrastructure tag:network
                      </div>
                    </div>
                    {tabs.length === 0 ? (
                      <div className="list-group-item">No tabs configured.</div>
                    ) : (
                      tabs.map((tab) => (
                        <div key={tab.id} className="list-group-item">
                          <strong>{tab.title}</strong>{" "}
                          <span className="cachet-row-meta">
                            {tab.isGlobal ? "global" : "tenant"} · {tab.enabled ? "enabled" : "disabled"}
                          </span>
                          <div className="pull-right cachet-row-actions">
                            <button className="btn btn-link" type="button" onClick={() => handleTabEdit(tab)}>
                              Edit
                            </button>
                            <button className="btn btn-link" type="button" disabled={tabs.length <= 1} onClick={() => void handleTabDelete(tab)}>
                              Delete
                            </button>
                          </div>
                          <div className="cachet-row-meta">Filter: {tab.filterQuery || "all services"}</div>
                        </div>
                      ))
                    )}
                    <div className="list-group-item">
                      <strong>Status colors</strong>
                      <div className="pull-right">
                        <button className="btn btn-link" type="button" onClick={() => setAdminModal("colors")}>
                          Edit
                        </button>
                      </div>
                      <div className="cachet-row-meta">{colors.map((entry) => `${entry.label} ${entry.colorHex}`).join(" · ")}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {adminModal === "tenant" && (
        <ModalFrame title={editingTenantId ? "Edit tenant" : "Create tenant"} description="Tenants are logical locations or customer partitions." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleTenantSave}>
            <label>
              Tenant name
              <input value={tenantForm.name} onChange={(event) => setTenantForm((current) => ({ ...current, name: event.target.value }))} placeholder="North campus" />
            </label>
            <label>
              URL slug
              <input value={tenantForm.slug} onChange={(event) => setTenantForm((current) => ({ ...current, slug: event.target.value }))} placeholder="north-campus" />
            </label>
            <label>
              Description
              <textarea rows={3} value={tenantForm.description} onChange={(event) => setTenantForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={tenantForm.enabled} onChange={(event) => setTenantForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              {editingTenantId ? "Save tenant" : "Create tenant"}
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "service" && (
        <ModalFrame
          title={editingServiceId ? "Edit service" : "Create service"}
          description="Services are the status-page rows. Tabs place them by category, topic, tag, service name, or slug filters."
          onClose={closeAdminModal}
        >
          <form className="cachet-form" onSubmit={handleServiceSave}>
            <div className="cachet-form-grid">
              <label>
                Service name
                <input value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} placeholder="TN Core Network" />
              </label>
              <label>
                URL slug
                <input value={serviceForm.slug} onChange={(event) => setServiceForm((current) => ({ ...current, slug: event.target.value }))} placeholder="tn-core-network" />
              </label>
            </div>
            <div className="cachet-form-grid">
              <label>
                Category
                <input value={serviceForm.category} onChange={(event) => setServiceForm((current) => ({ ...current, category: event.target.value }))} placeholder="infrastructure" />
              </label>
              <label>
                Topic
                <input value={serviceForm.topic} onChange={(event) => setServiceForm((current) => ({ ...current, topic: event.target.value }))} placeholder="network" />
              </label>
            </div>
            <label>
              Tags
              <input value={serviceForm.tags} onChange={(event) => setServiceForm((current) => ({ ...current, tags: event.target.value }))} placeholder="network, critical" />
              <span className="field-help">Comma-separated tags. A tab filter like tag:network will include this service.</span>
            </label>
            <div className="cachet-form-grid">
              <label>
                Source type
                <select value={serviceForm.sourceType} onChange={(event) => setServiceForm((current) => ({ ...current, sourceType: event.target.value as ServiceDefinition["sourceType"] }))}>
                  <option value="zabbix">Zabbix</option>
                  <option value="prometheus">Prometheus</option>
                  <option value="prtg">PRTG</option>
                  <option value="webhook">Webhook</option>
                </select>
              </label>
              <label>
                Source ref
                <input value={serviceForm.sourceRef} onChange={(event) => setServiceForm((current) => ({ ...current, sourceRef: event.target.value }))} placeholder="zabbix:tn-core-network" />
              </label>
            </div>
            <span className="field-help">
              Source ref is the join key. For Zabbix, set connector config services to e.g. {"[{ \"ref\": \"zabbix:tn-core-network\", \"summary\": \"TN Core Network\" }]"}.
            </span>
            <label className="checkbox-row">
              <input type="checkbox" checked={serviceForm.enabled} onChange={(event) => setServiceForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              {editingServiceId ? "Save service" : "Create service"}
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "connector" && (
        <ModalFrame title={editingConnectorId ? "Edit connector" : "Create connector"} description={connectorFormHelp.nameHelp} onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleConnectorCreate}>
            <label>
              Type
              <select value={connectorForm.type} onChange={(event) => handleConnectorTypeChange(event.target.value as IntegrationConnector["type"])}>
                <option value="zabbix">Zabbix</option>
                <option value="prometheus">Prometheus</option>
                <option value="prtg">PRTG</option>
                <option value="webhook">Webhook</option>
              </select>
            </label>
            <label>
              Display name
              <input value={connectorForm.name} onChange={(event) => setConnectorForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              Config JSON
              <textarea rows={5} value={connectorForm.configJson} onChange={(event) => setConnectorForm((current) => ({ ...current, configJson: event.target.value }))} />
              <span className="field-help">{connectorFormHelp.configHelp}</span>
            </label>
            <label>
              Auth JSON
              <textarea rows={5} value={connectorForm.authJson} onChange={(event) => setConnectorForm((current) => ({ ...current, authJson: event.target.value }))} />
              <span className="field-help">{connectorFormHelp.authHelp}</span>
            </label>
            <label>
              Poll interval seconds
              <input type="number" min={60} max={2678400} disabled={connectorForm.type === "webhook"} value={connectorForm.pollIntervalSeconds} onChange={(event) => setConnectorForm((current) => ({ ...current, pollIntervalSeconds: Number(event.target.value) || current.pollIntervalSeconds }))} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={connectorForm.enabled} onChange={(event) => setConnectorForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              {editingConnectorId ? "Save connector" : "Create connector"}
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "user" && (
        <ModalFrame title="Create user" onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleUserCreate}>
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
                <input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} />
              </label>
            )}
            <label className="checkbox-row">
              <input type="checkbox" checked={userForm.enabled} onChange={(event) => setUserForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              Create user
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "subscription" && (
        <ModalFrame title="Create subscription" onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleSubscriptionCreate}>
            <label>
              Channel
              <select value={subscriptionForm.channelType} onChange={(event) => setSubscriptionForm((current) => ({ ...current, channelType: event.target.value as "slack" | "email" }))}>
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
              <input value={subscriptionForm.target} onChange={(event) => setSubscriptionForm((current) => ({ ...current, target: event.target.value }))} placeholder={subscriptionForm.channelType === "slack" ? "https://hooks.slack.com/..." : "user@example.org"} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={subscriptionForm.enabled} onChange={(event) => setSubscriptionForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              Create subscription
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "slack-settings" && (
        <ModalFrame title="Global Slack webhook" description="Configure the default outbound Slack webhook used for status transition notifications." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleNotificationSettingsSave}>
            <label>
              Global Slack webhook URL
              <input value={notificationSettingsForm.slackWebhookUrl} onChange={(event) => setNotificationSetting("slackWebhookUrl", event.target.value)} placeholder="https://hooks.slack.com/..." />
            </label>
            <button className="btn btn-success" type="submit">
              Save Slack settings
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "smtp-settings" && (
        <ModalFrame title="SMTP server" description="Configure outbound email delivery used by email subscriptions and status transitions." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleNotificationSettingsSave}>
            <div className="cachet-form-section">
              <h3>SMTP server</h3>
              <label>
                Host
                <input value={notificationSettingsForm.smtpHost} onChange={(event) => setNotificationSetting("smtpHost", event.target.value)} placeholder="smtp.example.org" />
              </label>
              <label>
                Port
                <input type="number" min={1} max={65535} value={notificationSettingsForm.smtpPort} onChange={(event) => setNotificationSetting("smtpPort", Number(event.target.value) || 587)} />
              </label>
              <label>
                Username
                <input value={notificationSettingsForm.smtpUser} onChange={(event) => setNotificationSetting("smtpUser", event.target.value)} />
              </label>
              <label>
                Password
                <input type="password" value={notificationSettingsForm.smtpPassword} onChange={(event) => setNotificationSetting("smtpPassword", event.target.value)} />
              </label>
              <label>
                From address
                <input type="email" value={notificationSettingsForm.smtpFrom} onChange={(event) => setNotificationSetting("smtpFrom", event.target.value)} placeholder="status@example.org" />
              </label>
            </div>
            <button className="btn btn-success" type="submit">
              Save SMTP settings
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "auth-settings" && (
        <ModalFrame title="Authentication and identity provider settings" description="Define the external IdP here: OIDC/OAuth2 issuer and client credentials, SAML IdP metadata, or LDAP directory settings." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleAuthSettingsSave}>
            <div className="cachet-form-section">
              <h3>Access modes</h3>
              <label>
                Status page access
                <select value={authSettingsForm.publicAuthMode} onChange={(event) => setAuthSetting("publicAuthMode", event.target.value as AuthMode)}>
                  {authModeChoices.map((mode) => (
                    <option key={mode} value={mode}>
                      {authModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                IP allowlist
                <input value={authSettingsForm.allowedIpRanges.join(", ")} onChange={(event) => setAuthSetting("allowedIpRanges", event.target.value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean))} placeholder="192.0.2.0/24, 2001:db8::/32" />
                <span className="field-help">Used when the status page access mode is IP allowlist.</span>
              </label>
              <div className="cachet-checkbox-group">
                <strong>Admin sign-in modes</strong>
                {adminAuthModeChoices.map((mode) => (
                  <label key={mode} className="checkbox-row">
                    <input type="checkbox" checked={authSettingsForm.adminAuthModes.includes(mode)} onChange={() => toggleAdminAuthMode(mode)} />
                    {authModeLabel(mode)}
                  </label>
                ))}
                <span className="field-help">Keep Local enabled until the remote IdP has been tested to avoid lockout.</span>
              </div>
            </div>

            <div className="cachet-form-section">
              <h3>LDAP</h3>
              <label>
                LDAP URL
                <input value={authSettingsForm.ldap.url} onChange={(event) => setLdapSetting("url", event.target.value)} placeholder="ldaps://ldap.example.org" />
              </label>
              <label>
                Base DN
                <input value={authSettingsForm.ldap.baseDn} onChange={(event) => setLdapSetting("baseDn", event.target.value)} placeholder="ou=people,dc=example,dc=org" />
              </label>
              <label>
                Bind DN
                <input value={authSettingsForm.ldap.bindDn} onChange={(event) => setLdapSetting("bindDn", event.target.value)} />
              </label>
              <label>
                Bind password
                <input type="password" value={authSettingsForm.ldap.bindPassword} onChange={(event) => setLdapSetting("bindPassword", event.target.value)} />
              </label>
              <label>
                User filter
                <input value={authSettingsForm.ldap.userFilter} onChange={(event) => setLdapSetting("userFilter", event.target.value)} placeholder="(uid={username})" />
              </label>
              <div className="cachet-form-grid">
                <label>
                  Username attribute
                  <input value={authSettingsForm.ldap.usernameAttribute} onChange={(event) => setLdapSetting("usernameAttribute", event.target.value)} />
                </label>
                <label>
                  Display name attribute
                  <input value={authSettingsForm.ldap.displayNameAttribute} onChange={(event) => setLdapSetting("displayNameAttribute", event.target.value)} />
                </label>
                <label>
                  Email attribute
                  <input value={authSettingsForm.ldap.emailAttribute} onChange={(event) => setLdapSetting("emailAttribute", event.target.value)} />
                </label>
              </div>
            </div>

            <div className="cachet-form-section">
              <h3>OIDC and OAuth2</h3>
              <label>
                OIDC issuer URL
                <input value={authSettingsForm.oidc.issuerUrl} onChange={(event) => setOidcSetting("issuerUrl", event.target.value)} placeholder="https://idp.example.org/.well-known/openid-configuration" />
              </label>
              <div className="cachet-form-grid">
                <label>
                  Client ID
                  <input value={authSettingsForm.oidc.clientId} onChange={(event) => setOidcSetting("clientId", event.target.value)} />
                </label>
                <label>
                  Client secret
                  <input type="password" value={authSettingsForm.oidc.clientSecret} onChange={(event) => setOidcSetting("clientSecret", event.target.value)} />
                </label>
              </div>
              <label>
                Scopes
                <input value={authSettingsForm.oidc.scopes.join(" ")} onChange={(event) => setOidcSetting("scopes", event.target.value.split(/\s+/).map((entry) => entry.trim()).filter(Boolean))} />
              </label>
              <div className="cachet-form-grid">
                <label>
                  Username claim
                  <input value={authSettingsForm.oidc.usernameClaim} onChange={(event) => setOidcSetting("usernameClaim", event.target.value)} />
                </label>
                <label>
                  Display claim
                  <input value={authSettingsForm.oidc.displayNameClaim} onChange={(event) => setOidcSetting("displayNameClaim", event.target.value)} />
                </label>
                <label>
                  Email claim
                  <input value={authSettingsForm.oidc.emailClaim} onChange={(event) => setOidcSetting("emailClaim", event.target.value)} />
                </label>
              </div>
              <label>
                Prompt
                <input value={authSettingsForm.oidc.prompt} onChange={(event) => setOidcSetting("prompt", event.target.value)} placeholder="login consent" />
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={authSettingsForm.oidc.useUserInfo} onChange={(event) => setOidcSetting("useUserInfo", event.target.checked)} />
                Fetch userinfo after token exchange
              </label>
              <label>
                OAuth2 userinfo URL
                <input value={authSettingsForm.remoteAuth.userinfoUrl} onChange={(event) => setRemoteAuthSetting("userinfoUrl", event.target.value)} />
              </label>
              <label>
                OAuth2 introspection URL
                <input value={authSettingsForm.remoteAuth.introspectionUrl} onChange={(event) => setRemoteAuthSetting("introspectionUrl", event.target.value)} />
              </label>
              <div className="cachet-form-grid">
                <label>
                  OAuth2 client ID
                  <input value={authSettingsForm.remoteAuth.clientId} onChange={(event) => setRemoteAuthSetting("clientId", event.target.value)} />
                </label>
                <label>
                  OAuth2 client secret
                  <input type="password" value={authSettingsForm.remoteAuth.clientSecret} onChange={(event) => setRemoteAuthSetting("clientSecret", event.target.value)} />
                </label>
              </div>
              <div className="cachet-form-grid">
                <label>
                  Username claim
                  <input value={authSettingsForm.remoteAuth.usernameClaim} onChange={(event) => setRemoteAuthSetting("usernameClaim", event.target.value)} />
                </label>
                <label>
                  Display claim
                  <input value={authSettingsForm.remoteAuth.displayNameClaim} onChange={(event) => setRemoteAuthSetting("displayNameClaim", event.target.value)} />
                </label>
                <label>
                  Email claim
                  <input value={authSettingsForm.remoteAuth.emailClaim} onChange={(event) => setRemoteAuthSetting("emailClaim", event.target.value)} />
                </label>
              </div>
            </div>

            <div className="cachet-form-section">
              <h3>SAML</h3>
              <label>
                IdP entry point
                <input value={authSettingsForm.saml.entryPoint} onChange={(event) => setSamlSetting("entryPoint", event.target.value)} placeholder="https://idp.example.org/saml/sso" />
              </label>
              <label>
                Service provider issuer
                <input value={authSettingsForm.saml.issuer} onChange={(event) => setSamlSetting("issuer", event.target.value)} />
              </label>
              <label>
                IdP certificate
                <textarea rows={5} value={authSettingsForm.saml.idpCert} onChange={(event) => setSamlSetting("idpCert", event.target.value)} />
              </label>
              <label>
                SP private key
                <textarea rows={5} value={authSettingsForm.saml.privateKey} onChange={(event) => setSamlSetting("privateKey", event.target.value)} />
              </label>
              <label>
                SP public certificate
                <textarea rows={5} value={authSettingsForm.saml.publicCert} onChange={(event) => setSamlSetting("publicCert", event.target.value)} />
              </label>
              <div className="cachet-form-grid">
                <label>
                  Name ID attribute
                  <input value={authSettingsForm.saml.nameIdAttribute} onChange={(event) => setSamlSetting("nameIdAttribute", event.target.value)} />
                </label>
                <label>
                  Display attribute
                  <input value={authSettingsForm.saml.displayNameAttribute} onChange={(event) => setSamlSetting("displayNameAttribute", event.target.value)} />
                </label>
                <label>
                  Email attribute
                  <input value={authSettingsForm.saml.emailAttribute} onChange={(event) => setSamlSetting("emailAttribute", event.target.value)} />
                </label>
              </div>
            </div>

            <button className="btn btn-success" type="submit">
              Save authentication settings
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "branding" && (
        <ModalFrame title="Edit branding" description="The logo is displayed at the top of both the public status page and the admin page." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleBrandingSave}>
            <label>
              Application name
              <input value={branding.appName} onChange={(event) => setBranding((current) => ({ ...current, appName: event.target.value }))} />
            </label>
            <label htmlFor="branding-logo-url">Logo URL</label>
            <div className="cachet-form-field">
              <input id="branding-logo-url" value={branding.logoUrl} onChange={(event) => setBranding((current) => ({ ...current, logoUrl: event.target.value }))} />
              <span className="field-help">Use a reachable image URL for the header logo on the status and admin pages.</span>
            </div>
            <label>
              Favicon URL
              <input value={branding.faviconUrl} onChange={(event) => setBranding((current) => ({ ...current, faviconUrl: event.target.value }))} />
            </label>
            <label>
              Default theme
              <select value={branding.themeDefault} onChange={(event) => setBranding((current) => ({ ...current, themeDefault: event.target.value as "light" | "dark" }))}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <button className="btn btn-success" type="submit">
              Save branding
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "tab" && (
        <ModalFrame title={editingTabId ? "Edit tab" : "Create tab"} description="Tabs group status rows by matching service metadata." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleTabSave}>
            <label>
              Title
              <input value={tabForm.title} onChange={(event) => setTabForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label htmlFor="tab-filter-query">Filter query</label>
            <div className="cachet-form-field">
              <input id="tab-filter-query" value={tabForm.filterQuery} onChange={(event) => setTabForm((current) => ({ ...current, filterQuery: event.target.value }))} placeholder="category:network tag:critical" />
              <span className="field-help">
                Selects which services appear in this tab. Supported tokens: category:value, tag:value, topic:value, service:value. Multiple tokens are ANDed; blank means all services.
              </span>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={tabForm.isGlobal} onChange={(event) => setTabForm((current) => ({ ...current, isGlobal: event.target.checked }))} />
              Global tab
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={tabForm.enabled} onChange={(event) => setTabForm((current) => ({ ...current, enabled: event.target.checked }))} />
              Enabled
            </label>
            <button className="btn btn-success" type="submit">
              {editingTabId ? "Save tab" : "Create tab"}
            </button>
          </form>
        </ModalFrame>
      )}

      {adminModal === "colors" && (
        <ModalFrame title="Edit status colors" onClose={closeAdminModal}>
          <div className="cachet-form">
            {colors.map((entry, index) => (
              <label key={entry.statusKey}>
                {entry.label}
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
            <button className="btn btn-success" type="button" onClick={() => void handleColorSave()}>
              Save colors
            </button>
          </div>
        </ModalFrame>
      )}

      {adminModal === "banner" && (
        <ModalFrame title={editingBannerId ? "Edit banner" : "Publish banner"} description="Banners are public messages scoped to a tenant, tab, category, service, or globally." onClose={closeAdminModal}>
          <form className="cachet-form" onSubmit={handleBannerSave}>
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
              <span className="field-help">Use a tenant slug, tab slug, category, service slug/id, or leave blank for a broad scope.</span>
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
                {statusChoices.map((statusKey) => (
                  <option key={statusKey} value={statusKey}>
                    {statusLabel(statusKey)}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-success" type="submit">
              {editingBannerId ? "Save banner" : "Publish banner"}
            </button>
          </form>
        </ModalFrame>
      )}

      <footer className="footer">
        <div className="container footer-inner">
          <p>Admin control plane for {adminMeta.appName}.</p>
          <ul className="list-inline">
            <li>
              <button className="btn btn-link" type="button" onClick={() => setThemeMode(theme === "dark" ? "light" : "dark")}>
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
            </li>
            <li>
              <NavLink className="btn btn-link" to="/">
                Status
              </NavLink>
            </li>
          </ul>
        </div>
      </footer>
    </div>
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
