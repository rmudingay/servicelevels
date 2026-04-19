import type { IntegrationConnector, ServiceDefinition } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome, JsonObject } from "./shared.js";
import {
  buildBasicAuthHeader,
  buildServiceResult,
  buildUrl,
  getNumber,
  getNumberArray,
  getObjectArray,
  getString,
  isRecord,
  normalizeStatusFromText,
  parseJsonObject,
  requestJson,
  statusFromNumericValue
} from "./shared.js";
import { demoConnectorOutcome } from "./demo.js";

type PrometheusServiceMapping = {
  ref?: string;
  sourceRef?: string;
  name?: string;
  slug?: string;
  query?: string;
  ruleName?: string;
  alertName?: string;
  labels?: Record<string, string>;
  summary?: string;
  degradedThreshold?: number;
  downThreshold?: number;
  healthyThreshold?: number;
};

type PrometheusConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  mode?: "demo" | "alerts" | "queries" | "mixed";
  summary?: string;
  headers?: Record<string, string>;
  query?: string;
  ruleName?: string;
  services?: PrometheusServiceMapping[];
};

type PrometheusAuth = {
  bearerToken?: string;
  username?: string;
  password?: string;
  headers?: Record<string, string>;
};

type PrometheusAlert = {
  labels?: Record<string, string>;
  state?: string;
  activeAt?: string;
};

function resolveBaseUrl(config: PrometheusConfig): string | undefined {
  return config.baseUrl?.trim() || undefined;
}

function matchesLabels(actual: Record<string, string> | undefined, expected: Record<string, string> | undefined): boolean {
  if (!expected || Object.keys(expected).length === 0) {
    return true;
  }
  if (!actual) {
    return false;
  }
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function hasActionableMapping(mapping: PrometheusServiceMapping | undefined): boolean {
  return Boolean(
    mapping &&
      (mapping.query ||
        mapping.ruleName ||
        mapping.alertName ||
        (mapping.labels && Object.keys(mapping.labels).length > 0) ||
        typeof mapping.degradedThreshold === "number" ||
        typeof mapping.downThreshold === "number" ||
        typeof mapping.healthyThreshold === "number")
  );
}

function resolveServiceMapping(service: ServiceDefinition, config: PrometheusConfig): PrometheusServiceMapping | undefined {
  const services = config.services ?? [];
  const candidates = services.filter((entry) => {
    const keys = [entry.ref, entry.sourceRef, entry.slug, entry.name];
    return keys.some((key) => key && [service.id, service.slug, service.sourceRef, service.name].some((candidate) => candidate === key || candidate.includes(key)));
  });
  const explicit = candidates[0];
  if (hasActionableMapping(explicit)) {
    return explicit;
  }

  if (config.query || config.ruleName || looksLikePromql(service.sourceRef)) {
    return {
      query: config.query ?? (looksLikePromql(service.sourceRef) ? service.sourceRef : undefined),
      ruleName: config.ruleName,
      summary: config.summary
    };
  }

  return undefined;
}

async function prometheusRequest(baseUrl: string, path: string, query: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>, auth: PrometheusAuth, timeoutMs: number): Promise<JsonObject> {
  const headers: Record<string, string> = {
    ...(auth.headers ?? {})
  };
  if (auth.bearerToken) {
    headers.authorization = `Bearer ${auth.bearerToken}`;
  } else if (auth.username && auth.password) {
    headers.authorization = buildBasicAuthHeader(auth.username, auth.password);
  }
  const response = await requestJson(buildUrl(baseUrl, path, query), {
    headers,
    timeoutMs
  });
  if (!isRecord(response)) {
    throw new Error(`Unexpected Prometheus response from ${path}`);
  }
  if (response.status && response.status !== "success") {
    const errorMessage = isRecord(response.error) && typeof response.errorType === "string" ? `${response.errorType}: ${String(response.error)}` : `Prometheus request failed for ${path}`;
    throw new Error(errorMessage);
  }
  return response;
}

function extractNumericSamples(result: unknown): number[] {
  const samples: number[] = [];
  if (!Array.isArray(result)) {
    return samples;
  }

  for (const entry of result) {
    if (!isRecord(entry)) {
      continue;
    }
    if (Array.isArray(entry.value) && entry.value.length >= 2) {
      const numeric = Number(entry.value[1]);
      if (Number.isFinite(numeric)) {
        samples.push(numeric);
      }
    }
    if (Array.isArray(entry.values)) {
      for (const tuple of entry.values) {
        if (Array.isArray(tuple) && tuple.length >= 2) {
          const numeric = Number(tuple[1]);
          if (Number.isFinite(numeric)) {
            samples.push(numeric);
          }
        }
      }
    }
  }
  return samples;
}

function statusFromValue(value: number, service: ServiceDefinition, mapping: PrometheusServiceMapping): { status: "healthy" | "degraded" | "down"; summary: string } {
  if (typeof mapping.downThreshold === "number" && value >= mapping.downThreshold) {
    return { status: "down", summary: mapping.summary ?? `${service.name} reported value ${value}` };
  }
  if (typeof mapping.degradedThreshold === "number" && value >= mapping.degradedThreshold) {
    return { status: "degraded", summary: mapping.summary ?? `${service.name} reported value ${value}` };
  }
  if (typeof mapping.healthyThreshold === "number" && value <= mapping.healthyThreshold) {
    return { status: "healthy", summary: mapping.summary ?? `${service.name} reported value ${value}` };
  }
  return { status: statusFromNumericValue(value, service.name) as "healthy" | "degraded" | "down", summary: mapping.summary ?? `${service.name} reported value ${value}` };
}

function alertsForService(alerts: PrometheusAlert[], mapping: PrometheusServiceMapping): PrometheusAlert[] {
  return alerts.filter((alert) => {
    const labels = alert.labels ?? {};
    const expected = mapping.labels ?? {};
    if (!matchesLabels(labels, expected)) {
      return false;
    }
    const alertName = labels.alertname ?? "";
    if (mapping.ruleName && alertName !== mapping.ruleName && labels.rule !== mapping.ruleName) {
      return false;
    }
    if (mapping.alertName && alertName !== mapping.alertName) {
      return false;
    }
    return true;
  });
}

function normalizeAlertStatus(alerts: PrometheusAlert[], service: ServiceDefinition, mapping: PrometheusServiceMapping): { status: "healthy" | "degraded" | "down" | "maintenance"; summary: string } {
  if (alerts.length === 0) {
    return {
      status: "healthy",
      summary: mapping.summary ?? `${service.name} alerting is clear`
    };
  }

  const states = alerts.map((alert) => normalizeStatusFromText(alert.state ?? alert.labels?.severity ?? "degraded"));
  if (states.includes("maintenance")) {
    return { status: "maintenance", summary: mapping.summary ?? `${service.name} is under maintenance` };
  }
  if (states.includes("down")) {
    return { status: "down", summary: mapping.summary ?? `${service.name} has firing critical alerts` };
  }
  return { status: "degraded", summary: mapping.summary ?? `${service.name} has firing alerts` };
}

function looksLikePromql(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return /[{}()[\]\s:+\-*/]|(?:sum|avg|min|max|rate|increase|histogram_quantile)\s*\(/i.test(value);
}

async function collectPrometheusQueries(
  context: ConnectorCollectionContext,
  config: PrometheusConfig,
  auth: PrometheusAuth,
  service: ServiceDefinition,
  mapping: PrometheusServiceMapping
): Promise<{ result?: ReturnType<typeof buildServiceResult> }> {
  const baseUrl = resolveBaseUrl(config);
  if (!baseUrl) {
    return {};
  }

  const query = mapping.query ?? (looksLikePromql(service.sourceRef) ? service.sourceRef : undefined) ?? config.query;
  if (!query) {
    return {};
  }

  const response = await prometheusRequest(baseUrl, "/api/v1/query", { query }, auth, config.timeoutMs ?? 15_000);
  const data = isRecord(response.data) ? response.data : undefined;
  const resultType = getString(data?.resultType);
  const samples = extractNumericSamples(data?.result);
  const sampleValue = samples.length > 0 ? Math.max(...samples) : undefined;

  if (typeof sampleValue === "number") {
    const status = statusFromValue(sampleValue, service, mapping);
    return {
      result: buildServiceResult({
        tenant: context.tenant,
        connector: context.connector,
        service,
        banners: context.banners,
        tabs: context.tabs,
        previousSnapshot: context.previousSnapshot,
        now: context.now,
        status: status.status,
        summary: status.summary
      })
    };
  }

  if (resultType === "string") {
    return {
      result: buildServiceResult({
        tenant: context.tenant,
        connector: context.connector,
        service,
        banners: context.banners,
        tabs: context.tabs,
        previousSnapshot: context.previousSnapshot,
        now: context.now,
        status: "degraded",
        summary: mapping.summary ?? `${service.name} returned a textual Prometheus result`
      })
    };
  }

  return {};
}

async function collectPrometheusAlerts(
  context: ConnectorCollectionContext,
  config: PrometheusConfig,
  auth: PrometheusAuth,
  service: ServiceDefinition,
  mapping: PrometheusServiceMapping
): Promise<{ result?: ReturnType<typeof buildServiceResult> }> {
  const baseUrl = resolveBaseUrl(config);
  if (!baseUrl) {
    return {};
  }

  const alertsResponse = await prometheusRequest(baseUrl, "/api/v1/alerts", {}, auth, config.timeoutMs ?? 15_000);
  const data = isRecord(alertsResponse.data) ? alertsResponse.data : {};
  const alerts = getObjectArray(data.alerts).map((alert) => ({
    labels: isRecord(alert.labels) ? (alert.labels as Record<string, string>) : undefined,
    state: getString(alert.state),
    activeAt: getString(alert.activeAt)
  }));
  const matched = alertsForService(alerts, mapping);
  const normalized = normalizeAlertStatus(matched, service, mapping);

  return {
    result: buildServiceResult({
      tenant: context.tenant,
      connector: context.connector,
      service,
      banners: context.banners,
      tabs: context.tabs,
      previousSnapshot: context.previousSnapshot,
      now: context.now,
      status: normalized.status,
      summary: normalized.summary
    })
  };
}

export async function collectPrometheusConnector(context: ConnectorCollectionContext): Promise<ConnectorCollectionOutcome> {
  const config = parseJsonObject(context.connector.configJson) as PrometheusConfig;
  const auth = parseJsonObject(context.connector.authJson) as PrometheusAuth;

  if (config.mode === "demo" || !resolveBaseUrl(config)) {
    return demoConnectorOutcome(context, context.connector.configJson);
  }

  const results = [];
  try {
    for (const service of context.services) {
      const mapping = resolveServiceMapping(service, config);
      if (!mapping) {
        continue;
      }
      let collected: { result?: ReturnType<typeof buildServiceResult> } = {};

      if (config.mode === "alerts" || config.mode === "mixed" || mapping.ruleName || mapping.alertName) {
        collected = await collectPrometheusAlerts(context, config, auth, service, mapping);
      }

      if (!collected.result && (config.mode === "queries" || config.mode === "mixed" || mapping.query || config.query)) {
        collected = await collectPrometheusQueries(context, config, auth, service, mapping);
      }

      if (collected.result) {
        results.push(collected.result);
      }
    }

    return {
      results,
      run: {
        connector: context.connector,
        status: "success",
        touchedAt: context.now
      },
      rawPayload: {
        collectedServices: results.length
      }
    };
  } catch (error) {
    return {
      results: [],
      run: {
        connector: context.connector,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Prometheus collection failed",
        touchedAt: nowIso()
      }
    };
  }
}
