import { readFileSync } from "node:fs";
import { z } from "zod";

const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

function trimTrailingNewlines(value: string): string {
  return value.replace(/[\r\n]+$/, "");
}

function resolveFileBackedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env };

  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith("_FILE") || typeof value !== "string" || value.length === 0) {
      continue;
    }

    const targetKey = key.slice(0, -5);
    if (resolved[targetKey]) {
      continue;
    }

    try {
      resolved[targetKey] = trimTrailingNewlines(readFileSync(value, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Unable to read secret file for ${targetKey}: ${message}`);
    }
  }

  return resolved;
}

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: logLevelSchema.default("info"),
  APP_NAME: z.string().default("Service Levels application"),
  LOGO_URL: z.string().default(""),
  FAVICON_URL: z.string().default(""),
  THEME_DEFAULT: z.enum(["light", "dark"]).default("dark"),
  APP_BASE_URL: z.string().default("http://localhost:8080"),
  DATABASE_URL: z.string().default(""),
  PUBLIC_AUTH_MODE: z.enum(["public", "ip", "local", "ldap", "saml", "oauth", "oidc"]).default("public"),
  ADMIN_AUTH_MODES: z.string().default("local"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().default("change-me"),
  JWT_SECRET: z.string().default("dev-secret-change-me"),
  ALLOWED_IP_RANGES: z.string().default(""),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  LDAP_URL: z.string().default(""),
  LDAP_BASE_DN: z.string().default(""),
  LDAP_BIND_DN: z.string().default(""),
  LDAP_BIND_PASSWORD: z.string().default(""),
  LDAP_USER_FILTER: z.string().default("(uid={username})"),
  LDAP_USERNAME_ATTRIBUTE: z.string().default("uid"),
  LDAP_DISPLAY_NAME_ATTRIBUTE: z.string().default("displayName"),
  LDAP_EMAIL_ATTRIBUTE: z.string().default("mail"),
  REMOTE_USERINFO_URL: z.string().default(""),
  REMOTE_INTROSPECTION_URL: z.string().default(""),
  REMOTE_CLIENT_ID: z.string().default(""),
  REMOTE_CLIENT_SECRET: z.string().default(""),
  REMOTE_USERNAME_CLAIM: z.string().default("preferred_username"),
  REMOTE_DISPLAY_NAME_CLAIM: z.string().default("name"),
  REMOTE_EMAIL_CLAIM: z.string().default("email"),
  OIDC_ISSUER_URL: z.string().default(""),
  OIDC_CLIENT_ID: z.string().default(""),
  OIDC_CLIENT_SECRET: z.string().default(""),
  OIDC_SCOPES: z.string().default("openid profile email"),
  OIDC_USERNAME_CLAIM: z.string().default("preferred_username"),
  OIDC_DISPLAY_NAME_CLAIM: z.string().default("name"),
  OIDC_EMAIL_CLAIM: z.string().default("email"),
  OIDC_PROMPT: z.string().default(""),
  OIDC_USE_USERINFO: z.string().default("true"),
  SAML_ENTRY_POINT: z.string().default(""),
  SAML_ISSUER: z.string().default("service-levels-application"),
  SAML_IDP_CERT: z.string().default(""),
  SAML_PRIVATE_KEY: z.string().default(""),
  SAML_PUBLIC_CERT: z.string().default(""),
  SLACK_WEBHOOK_URL: z.string().default(""),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_FROM: z.string().default(""),
  STATUS_TIME_ZONE: z.string().default("UTC"),
  SAML_NAMEID_ATTRIBUTE: z.string().default("nameid"),
  SAML_DISPLAY_NAME_ATTRIBUTE: z.string().default("displayName"),
  SAML_EMAIL_ATTRIBUTE: z.string().default("mail"),
  WEB_DIST_DIR: z.string().default("../web/dist"),
  WORKER_TICK_SECONDS: z.coerce.number().int().positive().default(60)
});

export type AppConfig = {
  port: number;
  logLevel: z.infer<typeof logLevelSchema>;
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  themeDefault: "light" | "dark";
  appBaseUrl: string;
  databaseUrl: string;
  publicAuthMode: "public" | "ip" | "local" | "ldap" | "saml" | "oauth" | "oidc";
  adminAuthModes: Array<"public" | "ip" | "local" | "ldap" | "saml" | "oauth" | "oidc">;
  adminUsername: string;
  adminPassword: string;
  jwtSecret: string;
  allowedIpRanges: string[];
  corsOrigin: string;
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
  notifications: {
    slackWebhookUrl: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;
  };
  statusTimeZone: string;
  webDistDir: string;
  workerTickSeconds: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(resolveFileBackedEnv(env));
  return {
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    appName: parsed.APP_NAME,
    logoUrl: parsed.LOGO_URL,
    faviconUrl: parsed.FAVICON_URL,
    themeDefault: parsed.THEME_DEFAULT,
    appBaseUrl: parsed.APP_BASE_URL,
    databaseUrl: parsed.DATABASE_URL,
    publicAuthMode: parsed.PUBLIC_AUTH_MODE,
    adminAuthModes: parsed.ADMIN_AUTH_MODES.split(",").map((entry) => entry.trim()).filter(Boolean) as AppConfig["adminAuthModes"],
    adminUsername: parsed.ADMIN_USERNAME,
    adminPassword: parsed.ADMIN_PASSWORD,
    jwtSecret: parsed.JWT_SECRET,
    allowedIpRanges: parsed.ALLOWED_IP_RANGES.split(",").map((entry) => entry.trim()).filter(Boolean),
    corsOrigin: parsed.CORS_ORIGIN,
    ldap: {
      url: parsed.LDAP_URL,
      baseDn: parsed.LDAP_BASE_DN,
      bindDn: parsed.LDAP_BIND_DN,
      bindPassword: parsed.LDAP_BIND_PASSWORD,
      userFilter: parsed.LDAP_USER_FILTER,
      usernameAttribute: parsed.LDAP_USERNAME_ATTRIBUTE,
      displayNameAttribute: parsed.LDAP_DISPLAY_NAME_ATTRIBUTE,
      emailAttribute: parsed.LDAP_EMAIL_ATTRIBUTE
    },
    remoteAuth: {
      userinfoUrl: parsed.REMOTE_USERINFO_URL,
      introspectionUrl: parsed.REMOTE_INTROSPECTION_URL,
      clientId: parsed.REMOTE_CLIENT_ID,
      clientSecret: parsed.REMOTE_CLIENT_SECRET,
      usernameClaim: parsed.REMOTE_USERNAME_CLAIM,
      displayNameClaim: parsed.REMOTE_DISPLAY_NAME_CLAIM,
      emailClaim: parsed.REMOTE_EMAIL_CLAIM
    },
    oidc: {
      issuerUrl: parsed.OIDC_ISSUER_URL,
      clientId: parsed.OIDC_CLIENT_ID,
      clientSecret: parsed.OIDC_CLIENT_SECRET,
      scopes: parsed.OIDC_SCOPES.split(" ").map((entry) => entry.trim()).filter(Boolean),
      usernameClaim: parsed.OIDC_USERNAME_CLAIM,
      displayNameClaim: parsed.OIDC_DISPLAY_NAME_CLAIM,
      emailClaim: parsed.OIDC_EMAIL_CLAIM,
      prompt: parsed.OIDC_PROMPT,
      useUserInfo: parsed.OIDC_USE_USERINFO.trim().toLowerCase() !== "false"
    },
    saml: {
      entryPoint: parsed.SAML_ENTRY_POINT,
      issuer: parsed.SAML_ISSUER,
      idpCert: parsed.SAML_IDP_CERT,
      privateKey: parsed.SAML_PRIVATE_KEY,
      publicCert: parsed.SAML_PUBLIC_CERT,
      nameIdAttribute: parsed.SAML_NAMEID_ATTRIBUTE,
      displayNameAttribute: parsed.SAML_DISPLAY_NAME_ATTRIBUTE,
      emailAttribute: parsed.SAML_EMAIL_ATTRIBUTE
    },
    notifications: {
      slackWebhookUrl: parsed.SLACK_WEBHOOK_URL,
      smtpHost: parsed.SMTP_HOST,
      smtpPort: parsed.SMTP_PORT,
      smtpUser: parsed.SMTP_USER,
      smtpPassword: parsed.SMTP_PASSWORD,
      smtpFrom: parsed.SMTP_FROM
    },
    statusTimeZone: parsed.STATUS_TIME_ZONE,
    webDistDir: parsed.WEB_DIST_DIR,
    workerTickSeconds: parsed.WORKER_TICK_SECONDS
  };
}
