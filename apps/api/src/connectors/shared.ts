import type {
  Banner,
  IntegrationConnector,
  ServiceDefinition,
  Snapshot,
  StatusLevel,
  TabDefinition,
  Tenant
} from "@service-levels/shared";
import { Agent } from "undici";
import { statusSummary } from "../store/utils.js";
import { nowIso } from "../utils.js";

export type JsonObject = Record<string, unknown>;
export type RequestTlsOptions = {
  rejectUnauthorized?: boolean;
  ca?: string;
};

type FetchInit = Omit<RequestInit, "dispatcher"> & {
  dispatcher?: unknown;
};

export type ServiceResult = Snapshot["services"][number] & {
  sourceConnectorId: string | null;
  sourceConnectorType: IntegrationConnector["type"] | null;
  bannerIds: string[];
};

export type ConnectorRun = {
  connector: IntegrationConnector;
  status: "success" | "error";
  errorMessage?: string;
  touchedAt: string;
};

export type ConnectorCollectionContext = {
  tenant: Tenant;
  connector: IntegrationConnector;
  services: ServiceDefinition[];
  banners: Banner[];
  tabs: TabDefinition[];
  previousSnapshot: Snapshot | null;
  now: string;
};

export type ConnectorCollectionOutcome = {
  results: ServiceResult[];
  run: ConnectorRun;
  rawPayload?: unknown;
};

export function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonObject(input: string): JsonObject {
  try {
    const parsed = JSON.parse(input) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : String(entry))).filter(Boolean);
}

export function getNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return entry;
      }
      if (typeof entry === "string" && entry.trim()) {
        const parsed = Number(entry);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    })
    .filter((entry): entry is number => typeof entry === "number");
}

export function getObjectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function appendParam(params: URLSearchParams, key: string, value: string | number | boolean | Array<string | number | boolean>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      params.append(key, String(entry));
    }
    return;
  }
  params.set(key, String(value));
}

export function buildUrl(baseUrl: string, path: string, query: Record<string, string | number | boolean | Array<string | number | boolean> | undefined> = {}): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    appendParam(url.searchParams, key, value);
  }
  return url.toString();
}

function buildDispatcher(tls?: RequestTlsOptions): Agent | undefined {
  if (!tls || (tls.rejectUnauthorized === undefined && !tls.ca)) {
    return undefined;
  }
  return new Agent({
    connect: {
      rejectUnauthorized: tls.rejectUnauthorized,
      ca: tls.ca
    }
  });
}

function describeRequestFailure(url: string, error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Request to ${url} failed`);
  }
  const cause = error.cause;
  const causeMessage =
    cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : undefined;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : undefined;
  const detail = causeMessage ? `${causeCode ? `${causeCode}: ` : ""}${causeMessage}` : error.message;
  return new Error(`Request to ${url} failed: ${detail}`);
}

export async function requestJson(
  url: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    tls?: RequestTlsOptions;
  } = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const dispatcher = buildDispatcher(options.tls);
  try {
    const requestInit: FetchInit = {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    };
    if (dispatcher) {
      requestInit.dispatcher = dispatcher;
    }
    let response: Response;
    try {
      response = await fetch(url, requestInit as unknown as RequestInit);
    } catch (error) {
      throw describeRequestFailure(url, error);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with ${response.status}: ${text.slice(0, 240)}`);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  } finally {
    clearTimeout(timeout);
    await dispatcher?.close();
  }
}

export async function requestText(
  url: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    tls?: RequestTlsOptions;
  } = {}
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const dispatcher = buildDispatcher(options.tls);
  try {
    const requestInit: FetchInit = {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    };
    if (dispatcher) {
      requestInit.dispatcher = dispatcher;
    }
    let response: Response;
    try {
      response = await fetch(url, requestInit as unknown as RequestInit);
    } catch (error) {
      throw describeRequestFailure(url, error);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with ${response.status}: ${text.slice(0, 240)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
    await dispatcher?.close();
  }
}

export function parseHeaders(input: unknown): Record<string, string> {
  if (!isRecord(input)) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0) {
      headers[key] = value;
    }
  }
  return headers;
}

export function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function normalizeStatusFromText(value: string): StatusLevel {
  const text = value.trim().toLowerCase();
  if (!text) {
    return "unknown";
  }
  if (text.includes("maintenance") || text.includes("paused") || text.includes("suppress")) {
    return "maintenance";
  }
  if (text.includes("down") || text.includes("critical") || text.includes("disaster") || text.includes("error") || text.includes("failed")) {
    return "down";
  }
  if (text.includes("warn") || text.includes("degrad") || text.includes("unusual") || text.includes("partial") || text.includes("slow") || text.includes("firing")) {
    return "degraded";
  }
  if (text.includes("up") || text.includes("ok") || text.includes("healthy") || text.includes("success")) {
    return "healthy";
  }
  return "unknown";
}

export function severityToStatus(severity: number): StatusLevel {
  if (severity >= 4) {
    return "down";
  }
  if (severity >= 1) {
    return "degraded";
  }
  return "degraded";
}

export function prtgStatusToStatus(value: string): StatusLevel {
  const text = value.trim().toLowerCase();
  if (text.includes("paused")) {
    return "maintenance";
  }
  if (text.includes("down")) {
    return "down";
  }
  if (text.includes("warning") || text.includes("unusual")) {
    return "degraded";
  }
  if (text.includes("up")) {
    return "healthy";
  }
  if (text.includes("unknown")) {
    return "unknown";
  }
  return normalizeStatusFromText(text);
}

export function statusFromNumericValue(value: number, serviceName: string): StatusLevel {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  const lowerName = serviceName.toLowerCase();
  if (lowerName.includes("up") || lowerName.includes("healthy") || lowerName.includes("success") || lowerName.includes("available")) {
    return value > 0 ? "healthy" : "down";
  }
  if (lowerName.includes("maintenance") || lowerName.includes("pause")) {
    return value > 0 ? "maintenance" : "healthy";
  }
  if (value <= 0) {
    return "healthy";
  }
  if (value >= 100) {
    return "down";
  }
  return "degraded";
}

function matchesTokens(value: string | undefined, candidates: string[]): boolean {
  if (!value) {
    return false;
  }
  const needle = value.trim().toLowerCase();
  if (!needle) {
    return false;
  }
  return candidates.some((candidate) => candidate.toLowerCase() === needle || candidate.toLowerCase().includes(needle));
}

export function matchServiceDefinition(
  service: ServiceDefinition,
  matcher: {
    ref?: string;
    sourceRef?: string;
    slug?: string;
    name?: string;
    category?: string;
    topic?: string;
    tags?: string[];
  }
): boolean {
  const candidates = [service.id, service.slug, service.sourceRef, service.name, service.category, service.topic];

  const directMatch =
    matchesTokens(matcher.ref, candidates) ||
    matchesTokens(matcher.sourceRef, candidates) ||
    matchesTokens(matcher.slug, candidates) ||
    matchesTokens(matcher.name, candidates) ||
    matchesTokens(matcher.category, candidates) ||
    matchesTokens(matcher.topic, candidates);

  if (!directMatch && (matcher.ref || matcher.sourceRef || matcher.slug || matcher.name || matcher.category || matcher.topic)) {
    return false;
  }

  if (matcher.tags && matcher.tags.length > 0) {
    return matcher.tags.every((tag) => service.tags.includes(tag));
  }

  return directMatch || (!matcher.ref && !matcher.sourceRef && !matcher.slug && !matcher.name && !matcher.category && !matcher.topic);
}

export function bannerMatchesService(banner: Banner, tenant: Tenant, tabs: TabDefinition[], service: ServiceDefinition): boolean {
  if (!banner.active) {
    return false;
  }

  if (banner.scopeType === "global") {
    return true;
  }
  if (banner.scopeType === "tenant") {
    return banner.scopeRef === tenant.id || banner.scopeRef === tenant.slug || banner.scopeRef === "";
  }
  if (banner.scopeType === "category") {
    return banner.scopeRef === service.category;
  }
  if (banner.scopeType === "service") {
    return banner.scopeRef === service.id || banner.scopeRef === service.slug;
  }
  if (banner.scopeType === "tab") {
    return tabs.some((tab) => tab.enabled && (tab.id === banner.scopeRef || tab.slug === banner.scopeRef) && matchesFilter(service, tab.filterQuery));
  }
  return false;
}

export function matchesFilter(service: ServiceDefinition, filterQuery: string): boolean {
  const query = filterQuery.trim();
  if (!query) {
    return true;
  }

  return query.split(/\s+/).every((token) => {
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

export function buildServiceResult(input: {
  tenant: Tenant;
  connector: IntegrationConnector;
  service: ServiceDefinition;
  banners: Banner[];
  tabs: TabDefinition[];
  previousSnapshot: Snapshot | null;
  now?: string;
  status: StatusLevel;
  summary?: string;
}): ServiceResult {
  const now = input.now ?? nowIso();
  const bannerIds = input.banners.filter((banner) => bannerMatchesService(banner, input.tenant, input.tabs, input.service));
  const maintenanceBanner = bannerIds.find((banner) => banner.severity === "maintenance");
  if (maintenanceBanner) {
    return {
      serviceId: input.service.id,
      status: "maintenance",
      summary: maintenanceBanner.message,
      lastCheckedAt: now,
      sourceConnectorId: input.connector.id,
      sourceConnectorType: input.connector.type,
      bannerIds: bannerIds.map((banner) => banner.id)
    };
  }

  const previous = input.previousSnapshot?.services.find((entry) => entry.serviceId === input.service.id);
  return {
    serviceId: input.service.id,
    status: input.status,
    summary: input.summary ?? previous?.summary ?? statusSummary(input.status),
    lastCheckedAt: now,
    sourceConnectorId: input.connector.id,
    sourceConnectorType: input.connector.type,
    bannerIds: bannerIds.map((banner) => banner.id)
  };
}
