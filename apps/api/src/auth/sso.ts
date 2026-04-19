import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import * as oidc from "openid-client";
import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import type { AdminUser } from "@service-levels/shared";
import type { AppConfig } from "../config.js";
import type { StatusRepository } from "../store/types.js";

export type BrowserSsoMode = "oidc" | "oauth" | "saml";
export type LoginTarget = "status" | "admin";
type BrowserSsoLoginResult = { user: AdminUser; returnTo: string };
type SsoTestOverrides = {
  createBrowserRedirectUrl?: (
    config: AppConfig,
    mode: BrowserSsoMode,
    target: LoginTarget,
    returnTo?: string
  ) => Promise<string>;
  completeBrowserSsoLogin?: (
    store: StatusRepository,
    config: AppConfig,
    mode: BrowserSsoMode,
    stateToken: string | undefined,
    requestUrl?: URL,
    samlBody?: Record<string, string>
  ) => Promise<BrowserSsoLoginResult>;
  getSamlMetadata?: (config: AppConfig) => Promise<string> | string;
};

type SsoState = {
  provider: BrowserSsoMode;
  target: LoginTarget;
  returnTo: string;
  codeVerifier?: string;
  nonce?: string;
  createdAt: string;
};

type OidcIdentity = Pick<AdminUser, "username" | "displayName" | "email" | "authType">;

const stateLifetimeSeconds = 600;

let cachedOidc: {
  fingerprint: string;
  config: Promise<oidc.Configuration>;
} | null = null;

let cachedSaml: {
  fingerprint: string;
  instance: SAML;
} | null = null;
let testOverrides: SsoTestOverrides | null = null;

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

function resolveReturnTo(config: AppConfig, target: LoginTarget, returnTo?: string): string {
  const fallback = new URL(target === "admin" ? "/admin" : "/", config.corsOrigin).toString();
  if (!returnTo) {
    return fallback;
  }

  const resolved = new URL(returnTo, config.corsOrigin);
  if (resolved.origin !== normalizeOrigin(config.corsOrigin)) {
    return fallback;
  }
  return resolved.toString();
}

function signState(config: AppConfig, state: SsoState): string {
  return jwt.sign(state, config.jwtSecret, { expiresIn: stateLifetimeSeconds });
}

function readState(config: AppConfig, token: string | undefined): SsoState | null {
  if (!token) {
    return null;
  }
  try {
    return jwt.verify(token, config.jwtSecret) as SsoState;
  } catch {
    return null;
  }
}

function isOpenIdRequested(config: AppConfig, mode: BrowserSsoMode): boolean {
  return mode === "oidc" || config.oidc.scopes.includes("openid");
}

function readAttribute(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = readAttribute(entry);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [record.value, record._, record.text, record["#text"]];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
  }
  return undefined;
}

function toIdentity(
  username: string,
  displayName: string | undefined,
  email: string | undefined,
  authType: OidcIdentity["authType"]
): OidcIdentity {
  return {
    username,
    displayName: displayName || username,
    email: email || "",
    authType
  };
}

function normalizeOidcIdentity(
  config: AppConfig,
  claims: Record<string, unknown> | undefined,
  userInfo: Record<string, unknown> | undefined
): OidcIdentity | null {
  const source = { ...(claims ?? {}), ...(userInfo ?? {}) };
  const username = readAttribute(source[config.oidc.usernameClaim]) ?? readAttribute(source.preferred_username) ?? readAttribute(source.sub);
  if (!username) {
    return null;
  }

  const displayName =
    readAttribute(source[config.oidc.displayNameClaim]) ??
    readAttribute(source.name) ??
    readAttribute(source.given_name) ??
    readAttribute(source.nickname);
  const email = readAttribute(source[config.oidc.emailClaim]) ?? readAttribute(source.email);

  return toIdentity(username, displayName, email, "sso");
}

function normalizeSamlIdentity(config: AppConfig, profile: Profile): OidcIdentity | null {
  const username =
    readAttribute(profile[config.saml.nameIdAttribute]) ??
    readAttribute(profile.nameID) ??
    readAttribute(profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"]);
  if (!username) {
    return null;
  }

  const displayName =
    readAttribute(profile[config.saml.displayNameAttribute]) ??
    readAttribute(profile.displayName) ??
    readAttribute(profile.cn) ??
    readAttribute(profile.givenName);
  const email = readAttribute(profile[config.saml.emailAttribute]) ?? readAttribute(profile.mail) ?? readAttribute(profile.email);

  return toIdentity(username, displayName, email, "sso");
}

export function isBrowserRedirectMode(mode: string): mode is BrowserSsoMode {
  return mode === "oidc" || mode === "oauth" || mode === "saml";
}

export function browserRedirectModes(): BrowserSsoMode[] {
  return ["oidc", "oauth", "saml"];
}

function oidcFingerprint(config: AppConfig): string {
  return fingerprint([config.appBaseUrl, config.oidc.issuerUrl, config.oidc.clientId, config.oidc.clientSecret, config.oidc.scopes.join(" ")]);
}

function samlFingerprint(config: AppConfig): string {
  return fingerprint([config.appBaseUrl, config.saml.entryPoint, config.saml.issuer, config.saml.idpCert, config.saml.privateKey, config.saml.publicCert]);
}

async function getOidcConfiguration(config: AppConfig): Promise<oidc.Configuration> {
  if (!config.oidc.issuerUrl || !config.oidc.clientId) {
    throw new Error("OIDC is not configured");
  }

  const currentFingerprint = oidcFingerprint(config);
  if (!cachedOidc || cachedOidc.fingerprint !== currentFingerprint) {
    const issuer = new URL(config.oidc.issuerUrl);
    cachedOidc = {
      fingerprint: currentFingerprint,
      config: oidc.discovery(
        issuer,
        config.oidc.clientId,
        {
          redirect_uris: [`${config.appBaseUrl}/api/v1/auth/sso/oidc/callback`],
          response_types: ["code"],
          token_endpoint_auth_method: config.oidc.clientSecret ? "client_secret_basic" : "none"
        },
        config.oidc.clientSecret ? oidc.ClientSecretBasic(config.oidc.clientSecret) : oidc.None()
      )
    };
  }
  return cachedOidc.config;
}

function buildSamlInstance(config: AppConfig): SAML {
  if (!config.saml.entryPoint || !config.saml.idpCert) {
    throw new Error("SAML is not configured");
  }

  const options = {
    callbackUrl: `${config.appBaseUrl}/api/v1/auth/sso/saml/callback`,
    entryPoint: config.saml.entryPoint,
    issuer: config.saml.issuer,
    idpCert: config.saml.idpCert,
    additionalParams: {},
    additionalAuthorizeParams: {},
    additionalLogoutParams: {},
    identifierFormat: null,
    allowCreate: true,
    acceptedClockSkewMs: 0,
    disableRequestedAuthnContext: false,
    authnContext: [],
    forceAuthn: false,
    skipRequestCompression: false,
    passive: false,
    racComparison: "exact" as const,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    maxAssertionAgeMs: 0,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: stateLifetimeSeconds * 1000,
    logoutUrl: config.saml.entryPoint,
    disableRequestAcsUrl: false,
    publicCert: config.saml.publicCert || undefined
  };

  if (config.saml.privateKey) {
    return new SAML({
      ...options,
      privateKey: config.saml.privateKey,
      signatureAlgorithm: "sha256"
    });
  }

  return new SAML(options);
}

function getSamlInstance(config: AppConfig): SAML {
  const currentFingerprint = samlFingerprint(config);
  if (!cachedSaml || cachedSaml.fingerprint !== currentFingerprint) {
    cachedSaml = {
      fingerprint: currentFingerprint,
      instance: buildSamlInstance(config)
    };
  }
  return cachedSaml.instance;
}

function ensureTargetMode(config: AppConfig, mode: BrowserSsoMode, target: LoginTarget): void {
  if (target === "status" && config.publicAuthMode !== mode) {
    throw new Error("Selected authentication mode is not enabled for the status page");
  }
  if (target === "admin" && !config.adminAuthModes.includes(mode)) {
    throw new Error("Selected authentication mode is not enabled for admin access");
  }
}

export function buildSsoState(config: AppConfig, input: { provider: BrowserSsoMode; target: LoginTarget; returnTo?: string; codeVerifier?: string; nonce?: string }): string {
  const returnTo = resolveReturnTo(config, input.target, input.returnTo);
  return signState(config, {
    provider: input.provider,
    target: input.target,
    returnTo,
    codeVerifier: input.codeVerifier,
    nonce: input.nonce,
    createdAt: new Date().toISOString()
  });
}

export function parseSsoState(config: AppConfig, token: string | undefined): SsoState | null {
  return readState(config, token);
}

export function setSsoTestOverrides(overrides: SsoTestOverrides | null): void {
  testOverrides = overrides;
}

export async function createBrowserRedirectUrl(
  config: AppConfig,
  mode: BrowserSsoMode,
  target: LoginTarget,
  returnTo?: string
): Promise<string> {
  if (testOverrides?.createBrowserRedirectUrl) {
    return testOverrides.createBrowserRedirectUrl(config, mode, target, returnTo);
  }
  ensureTargetMode(config, mode, target);

  if (mode === "saml") {
    const saml = getSamlInstance(config);
    const relayState = buildSsoState(config, { provider: mode, target, returnTo });
    return saml.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  const oidcConfig = await getOidcConfiguration(config);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const shouldUseNonce = isOpenIdRequested(config, mode);
  const nonce = shouldUseNonce ? oidc.randomNonce() : undefined;
  const state = buildSsoState(config, {
    provider: mode,
    target,
    returnTo,
    codeVerifier,
    nonce
  });

  const parameters: Record<string, string> = {
    redirect_uri: `${config.appBaseUrl}/api/v1/auth/sso/oidc/callback`,
    response_type: "code",
    scope: config.oidc.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state
  };
  if (shouldUseNonce && nonce) {
    parameters.nonce = nonce;
  }
  if (config.oidc.prompt) {
    parameters.prompt = config.oidc.prompt;
  }

  return oidc.buildAuthorizationUrl(oidcConfig, parameters).toString();
}

export async function completeBrowserSsoLogin(
  store: StatusRepository,
  config: AppConfig,
  mode: BrowserSsoMode,
  stateToken: string | undefined,
  requestUrl?: URL,
  samlBody?: Record<string, string>
): Promise<BrowserSsoLoginResult> {
  if (testOverrides?.completeBrowserSsoLogin) {
    return testOverrides.completeBrowserSsoLogin(store, config, mode, stateToken, requestUrl, samlBody);
  }
  const state = parseSsoState(config, stateToken);
  if (!state || state.provider !== mode) {
    throw new Error("Invalid authentication transaction");
  }

  if (mode === "saml") {
    const saml = getSamlInstance(config);
    const response = await saml.validatePostResponseAsync(samlBody ?? {});
    if (response.loggedOut || !response.profile) {
      throw new Error("SAML login failed");
    }
    const identity = normalizeSamlIdentity(config, response.profile);
    if (!identity) {
      throw new Error("SAML identity missing");
    }
    const user = await store.upsertExternalUser(identity);
    if (state.target === "admin" && !user.isAdmin) {
      throw new Error("Admin access required");
    }
    return { user, returnTo: state.returnTo };
  }

  if (!requestUrl) {
    throw new Error("Missing callback URL");
  }
  const oidcConfig = await getOidcConfiguration(config);
  const tokens = await oidc.authorizationCodeGrant(oidcConfig, requestUrl, {
    pkceCodeVerifier: state.codeVerifier,
    expectedState: stateToken,
    expectedNonce: state.nonce
  });

  const claims = tokens.claims() as Record<string, unknown> | undefined;
  let userInfo: Record<string, unknown> | undefined;
  if (config.oidc.useUserInfo && tokens.access_token) {
    try {
      const subject = readAttribute(claims?.sub);
      userInfo = (await oidc.fetchUserInfo(
        oidcConfig,
        tokens.access_token,
        subject ? subject : oidc.skipSubjectCheck
      )) as Record<string, unknown>;
    } catch {
      userInfo = undefined;
    }
  }
  const identity = normalizeOidcIdentity(config, claims, userInfo);
  if (!identity) {
    throw new Error("OIDC identity missing");
  }
  const user = await store.upsertExternalUser(identity);
  if (state.target === "admin" && !user.isAdmin) {
    throw new Error("Admin access required");
  }
  return { user, returnTo: state.returnTo };
}

export async function getSamlMetadata(config: AppConfig): Promise<string> {
  if (testOverrides?.getSamlMetadata) {
    return await testOverrides.getSamlMetadata(config);
  }
  const saml = getSamlInstance(config);
  return await Promise.resolve(saml.generateServiceProviderMetadata(null, config.saml.publicCert || null));
}
