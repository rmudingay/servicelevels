import { Client } from "ldapts";
import type { AdminUser } from "@service-levels/shared";
import type { AppConfig } from "../config.js";
import type { StatusRepository } from "../store/types.js";

export type LoginMode = "local" | "ldap" | "saml" | "oauth" | "oidc";

export type LoginRequest = {
  mode?: LoginMode;
  username?: string;
  password?: string;
  token?: string;
  accessToken?: string;
  assertion?: string;
};

function enabledModes(config: AppConfig): LoginMode[] {
  const modes = new Set<LoginMode>(config.adminAuthModes.filter((mode): mode is LoginMode => mode !== "public" && mode !== "ip"));
  if (config.publicAuthMode !== "public" && config.publicAuthMode !== "ip") {
    modes.add(config.publicAuthMode);
  }
  if (modes.size === 0) {
    modes.add("local");
  }
  return [...modes];
}

function escapeLdapFilter(value: string): string {
  return value.replaceAll("\\", "\\5c").replaceAll("*", "\\2a").replaceAll("(", "\\28").replaceAll(")", "\\29").replaceAll("\0", "\\00");
}

function decodeMaybeBase64(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("<") || decoded.startsWith("{")) {
      return decoded;
    }
  } catch {
    // fall through to original string
  }
  return trimmed;
}

function extractXmlValue(xml: string, name: string): string | undefined {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}[^>]*>([^<]+)</(?:[A-Za-z0-9_]+:)?${name}>`, "i");
  const match = xml.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function extractSamlAttribute(xml: string, attributeName: string): string | undefined {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?Attribute[^>]*Name=["']${attributeName}["'][^>]*>\\s*<(?:[A-Za-z0-9_]+:)?AttributeValue[^>]*>([^<]+)</(?:[A-Za-z0-9_]+:)?AttributeValue>`,
    "i"
  );
  const match = xml.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function toAdminUser(identity: {
  username: string;
  displayName?: string;
  email?: string;
  authType: AdminUser["authType"];
}): Pick<AdminUser, "username" | "displayName" | "email" | "authType"> {
  return {
    username: identity.username,
    displayName: identity.displayName ?? identity.username,
    email: identity.email ?? "",
    authType: identity.authType
  };
}

async function authenticateLdap(config: AppConfig, username: string, password: string): Promise<Pick<AdminUser, "username" | "displayName" | "email" | "authType"> | null> {
  if (!config.ldap.url || !config.ldap.baseDn) {
    return null;
  }

  const client = new Client({ url: config.ldap.url });
  try {
    if (config.ldap.bindDn && config.ldap.bindPassword) {
      await client.bind(config.ldap.bindDn, config.ldap.bindPassword);
    }

    const filter = config.ldap.userFilter.replaceAll("{username}", escapeLdapFilter(username));
    const search = await client.search(config.ldap.baseDn, {
      filter,
      scope: "sub",
      attributes: [config.ldap.usernameAttribute, config.ldap.displayNameAttribute, config.ldap.emailAttribute]
    });
    const entry = search.searchEntries[0] as Record<string, unknown> | undefined;
    if (!entry || typeof entry.dn !== "string") {
      return null;
    }

    await client.bind(entry.dn, password);
    return toAdminUser({
      username: String(entry[config.ldap.usernameAttribute] ?? username),
      displayName: String(entry[config.ldap.displayNameAttribute] ?? username),
      email: String(entry[config.ldap.emailAttribute] ?? ""),
      authType: "ldap"
    });
  } finally {
    await client.unbind().catch(() => void 0);
  }
}

async function authenticateRemoteToken(config: AppConfig, mode: LoginMode, token: string): Promise<Pick<AdminUser, "username" | "displayName" | "email" | "authType"> | null> {
  const useIntrospection = Boolean(config.remoteAuth.introspectionUrl);
  const url = config.remoteAuth.userinfoUrl || config.remoteAuth.introspectionUrl;
  if (!url) {
    return null;
  }

  const headers: Record<string, string> = {};
  if (useIntrospection && config.remoteAuth.clientId && config.remoteAuth.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.remoteAuth.clientId}:${config.remoteAuth.clientSecret}`, "utf8").toString("base64")}`;
  } else {
    headers.authorization = `Bearer ${token}`;
  }
  if (useIntrospection) {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }

  const response = await fetch(url, {
    method: useIntrospection ? "POST" : "GET",
    headers,
    body: useIntrospection ? new URLSearchParams({ token }).toString() : undefined
  });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const username = String(payload[config.remoteAuth.usernameClaim] ?? payload.sub ?? "");
  if (!username) {
    return null;
  }

  return toAdminUser({
    username,
    displayName: String(payload[config.remoteAuth.displayNameClaim] ?? username),
    email: String(payload[config.remoteAuth.emailClaim] ?? ""),
    authType: mode === "ldap" ? "ldap" : "sso"
  });
}

async function authenticateSamlAssertion(config: AppConfig, assertion: string): Promise<Pick<AdminUser, "username" | "displayName" | "email" | "authType"> | null> {
  const xml = decodeMaybeBase64(assertion);
  if (!xml) {
    return null;
  }
  const username = extractXmlValue(xml, config.saml.nameIdAttribute) ?? extractXmlValue(xml, "NameID");
  if (!username) {
    return null;
  }
  return toAdminUser({
    username,
    displayName: extractSamlAttribute(xml, config.saml.displayNameAttribute) ?? username,
    email: extractSamlAttribute(xml, config.saml.emailAttribute) ?? "",
    authType: "sso"
  });
}

export function authModeLabels(): Record<LoginMode, string> {
  return {
    local: "Static account",
    ldap: "LDAP",
    saml: "SAML",
    oauth: "OAuth2",
    oidc: "OpenID Connect"
  };
}

export function availableAuthModes(config: AppConfig): LoginMode[] {
  return enabledModes(config);
}

export async function authenticateLogin(
  store: StatusRepository,
  config: AppConfig,
  request: LoginRequest
): Promise<AdminUser | null> {
  const mode = (request.mode ?? (config.publicAuthMode !== "public" && config.publicAuthMode !== "ip" ? config.publicAuthMode : "local")) as LoginMode;
  if (!enabledModes(config).includes(mode)) {
    return null;
  }

  if (mode === "local") {
    if (!request.username || !request.password) {
      return null;
    }
    const local = await store.verifyLocalCredentials(request.username, request.password);
    if (!local) {
      return null;
    }
    return local;
  }

  if (mode === "ldap") {
    if (!request.username || !request.password) {
      return null;
    }
    const identity = await authenticateLdap(config, request.username, request.password);
    if (!identity) {
      return null;
    }
    return store.upsertExternalUser(identity);
  }

  if (mode === "saml") {
    if (!request.assertion) {
      return null;
    }
    const identity = await authenticateSamlAssertion(config, request.assertion);
    if (!identity) {
      return null;
    }
    return store.upsertExternalUser(identity);
  }

  const token = request.token ?? request.accessToken;
  if (!token) {
    return null;
  }
  const identity = await authenticateRemoteToken(config, mode, token);
  if (!identity) {
    return null;
  }
  return store.upsertExternalUser(identity);
}
