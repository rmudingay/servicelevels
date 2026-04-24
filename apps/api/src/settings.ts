import type { AuthMode, AuthSettings, NotificationSettings, PlatformSettings } from "@service-levels/shared";
import type { AppConfig } from "./config.js";
import type { StatusRepository } from "./store/types.js";

const authModes: AuthMode[] = ["public", "ip", "local", "ldap", "saml", "oauth", "oidc"];
const adminCapableModes: AuthMode[] = ["local", "ldap", "saml", "oauth", "oidc"];

function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === "string" && authModes.includes(value as AuthMode);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function authSettingsFromConfig(config: AppConfig): AuthSettings {
  return {
    publicAuthMode: config.publicAuthMode,
    adminAuthModes: config.adminAuthModes,
    allowedIpRanges: config.allowedIpRanges,
    ldap: { ...config.ldap },
    remoteAuth: { ...config.remoteAuth },
    oidc: { ...config.oidc, scopes: [...config.oidc.scopes] },
    saml: { ...config.saml }
  };
}

export function notificationSettingsFromConfig(config: AppConfig): NotificationSettings {
  return { ...config.notifications };
}

export function platformSettingsFromConfig(config: AppConfig): PlatformSettings {
  return {
    auth: authSettingsFromConfig(config),
    notifications: notificationSettingsFromConfig(config)
  };
}

export function clonePlatformSettings(settings: PlatformSettings): PlatformSettings {
  return {
    auth: {
      ...settings.auth,
      allowedIpRanges: [...settings.auth.allowedIpRanges],
      ldap: { ...settings.auth.ldap },
      remoteAuth: { ...settings.auth.remoteAuth },
      oidc: { ...settings.auth.oidc, scopes: [...settings.auth.oidc.scopes] },
      saml: { ...settings.auth.saml }
    },
    notifications: { ...settings.notifications }
  };
}

export function normalizeAuthSettings(input: unknown, fallback: AuthSettings): AuthSettings {
  const raw = asRecord(input);
  const ldap = asRecord(raw.ldap);
  const remoteAuth = asRecord(raw.remoteAuth);
  const oidc = asRecord(raw.oidc);
  const saml = asRecord(raw.saml);
  const publicAuthMode = isAuthMode(raw.publicAuthMode) ? raw.publicAuthMode : fallback.publicAuthMode;
  const adminAuthModes = asStringArray(raw.adminAuthModes, fallback.adminAuthModes)
    .filter(isAuthMode)
    .filter((mode) => adminCapableModes.includes(mode));

  return {
    publicAuthMode,
    adminAuthModes: adminAuthModes.length > 0 ? adminAuthModes : fallback.adminAuthModes.filter((mode) => adminCapableModes.includes(mode)),
    allowedIpRanges: asStringArray(raw.allowedIpRanges, fallback.allowedIpRanges),
    ldap: {
      url: asString(ldap.url, fallback.ldap.url),
      baseDn: asString(ldap.baseDn, fallback.ldap.baseDn),
      bindDn: asString(ldap.bindDn, fallback.ldap.bindDn),
      bindPassword: asString(ldap.bindPassword, fallback.ldap.bindPassword),
      userFilter: asString(ldap.userFilter, fallback.ldap.userFilter),
      usernameAttribute: asString(ldap.usernameAttribute, fallback.ldap.usernameAttribute),
      displayNameAttribute: asString(ldap.displayNameAttribute, fallback.ldap.displayNameAttribute),
      emailAttribute: asString(ldap.emailAttribute, fallback.ldap.emailAttribute)
    },
    remoteAuth: {
      userinfoUrl: asString(remoteAuth.userinfoUrl, fallback.remoteAuth.userinfoUrl),
      introspectionUrl: asString(remoteAuth.introspectionUrl, fallback.remoteAuth.introspectionUrl),
      clientId: asString(remoteAuth.clientId, fallback.remoteAuth.clientId),
      clientSecret: asString(remoteAuth.clientSecret, fallback.remoteAuth.clientSecret),
      usernameClaim: asString(remoteAuth.usernameClaim, fallback.remoteAuth.usernameClaim),
      displayNameClaim: asString(remoteAuth.displayNameClaim, fallback.remoteAuth.displayNameClaim),
      emailClaim: asString(remoteAuth.emailClaim, fallback.remoteAuth.emailClaim)
    },
    oidc: {
      issuerUrl: asString(oidc.issuerUrl, fallback.oidc.issuerUrl),
      clientId: asString(oidc.clientId, fallback.oidc.clientId),
      clientSecret: asString(oidc.clientSecret, fallback.oidc.clientSecret),
      scopes: asStringArray(oidc.scopes, fallback.oidc.scopes),
      usernameClaim: asString(oidc.usernameClaim, fallback.oidc.usernameClaim),
      displayNameClaim: asString(oidc.displayNameClaim, fallback.oidc.displayNameClaim),
      emailClaim: asString(oidc.emailClaim, fallback.oidc.emailClaim),
      prompt: asString(oidc.prompt, fallback.oidc.prompt),
      useUserInfo: asBoolean(oidc.useUserInfo, fallback.oidc.useUserInfo)
    },
    saml: {
      entryPoint: asString(saml.entryPoint, fallback.saml.entryPoint),
      issuer: asString(saml.issuer, fallback.saml.issuer),
      idpCert: asString(saml.idpCert, fallback.saml.idpCert),
      privateKey: asString(saml.privateKey, fallback.saml.privateKey),
      publicCert: asString(saml.publicCert, fallback.saml.publicCert),
      nameIdAttribute: asString(saml.nameIdAttribute, fallback.saml.nameIdAttribute),
      displayNameAttribute: asString(saml.displayNameAttribute, fallback.saml.displayNameAttribute),
      emailAttribute: asString(saml.emailAttribute, fallback.saml.emailAttribute)
    }
  };
}

export function normalizeNotificationSettings(input: unknown, fallback: NotificationSettings): NotificationSettings {
  const raw = asRecord(input);
  return {
    slackWebhookUrl: asString(raw.slackWebhookUrl, fallback.slackWebhookUrl),
    smtpHost: asString(raw.smtpHost, fallback.smtpHost),
    smtpPort: asPositiveInteger(raw.smtpPort, fallback.smtpPort),
    smtpUser: asString(raw.smtpUser, fallback.smtpUser),
    smtpPassword: asString(raw.smtpPassword, fallback.smtpPassword),
    smtpFrom: asString(raw.smtpFrom, fallback.smtpFrom)
  };
}

export function normalizePlatformSettings(input: unknown, fallback: PlatformSettings): PlatformSettings {
  const raw = asRecord(input);
  return {
    auth: normalizeAuthSettings(raw.auth, fallback.auth),
    notifications: normalizeNotificationSettings(raw.notifications, fallback.notifications)
  };
}

export function applyPlatformSettings(config: AppConfig, settings: PlatformSettings): AppConfig {
  return {
    ...config,
    publicAuthMode: settings.auth.publicAuthMode,
    adminAuthModes: settings.auth.adminAuthModes,
    allowedIpRanges: settings.auth.allowedIpRanges,
    ldap: { ...settings.auth.ldap },
    remoteAuth: { ...settings.auth.remoteAuth },
    oidc: { ...settings.auth.oidc, scopes: [...settings.auth.oidc.scopes] },
    saml: { ...settings.auth.saml },
    notifications: { ...settings.notifications }
  };
}

export async function resolveEffectiveConfig(config: AppConfig, store: StatusRepository): Promise<AppConfig> {
  return applyPlatformSettings(config, await store.getPlatformSettings());
}
