import type { Banner, IntegrationConnector, ServiceDefinition, Snapshot, StatusLevel, TabDefinition, Tenant } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome, JsonObject } from "./shared.js";
import {
  bannerMatchesService,
  buildBasicAuthHeader,
  buildServiceResult,
  buildUrl,
  getNumberArray,
  getObjectArray,
  getString,
  isRecord,
  parseJsonObject,
  requestJson,
  severityToStatus,
  statusFromNumericValue
} from "./shared.js";
import { demoConnectorOutcome } from "./demo.js";
import { statusSummary, worstStatus } from "../store/utils.js";

type ZabbixMapping = {
  ref?: string;
  sourceRef?: string;
  name?: string;
  slug?: string;
  tags?: string[];
  hostIds?: Array<string | number>;
  groupIds?: Array<string | number>;
  severities?: number[];
  evaltype?: number;
  summary?: string;
  maintenanceSummary?: string;
  degradedSummary?: string;
  downSummary?: string;
  healthySummary?: string;
};

type ZabbixConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  mode?: "demo" | "api";
  summary?: string;
  defaultStatus?: StatusLevel;
  hostIds?: Array<string | number>;
  groupIds?: Array<string | number>;
  tags?: Array<{ tag: string; value?: string; operator?: string | number }>;
  severities?: number[];
  evaltype?: number;
  services?: ZabbixMapping[];
  tlsRejectUnauthorized?: boolean;
  caCert?: string;
};

type ZabbixAuth = {
  username?: string;
  password?: string;
  token?: string;
  sessionId?: string;
};

function resolveBaseUrl(config: ZabbixConfig): string | undefined {
  return config.baseUrl?.trim() || undefined;
}

function hasActionableFilters(mapping: ZabbixMapping | undefined): boolean {
  return Boolean(
    mapping &&
      ((mapping.hostIds && mapping.hostIds.length > 0) ||
        (mapping.groupIds && mapping.groupIds.length > 0) ||
        (mapping.tags && mapping.tags.length > 0) ||
        (mapping.severities && mapping.severities.length > 0))
  );
}

function resolveServiceMapping(service: ServiceDefinition, config: ZabbixConfig): ZabbixMapping | undefined {
  const services = config.services ?? [];
  const candidates = services.filter((entry) => {
    const keys = [entry.ref, entry.sourceRef, entry.slug, entry.name];
    return keys.some((key) => key && [service.id, service.slug, service.sourceRef, service.name].some((candidate) => candidate === key || candidate.includes(key)));
  });
  const explicit = candidates[0];
  if (hasActionableFilters(explicit)) {
    return explicit;
  }

  const globalMapping: ZabbixMapping = {
    hostIds: config.hostIds,
    groupIds: config.groupIds,
    tags: config.tags?.map((tag) => tag.tag) ?? [],
    severities: config.severities,
    evaltype: config.evaltype,
    summary: config.summary
  };

  return hasActionableFilters(globalMapping) ? globalMapping : undefined;
}

function buildTagFilters(tags: Array<{ tag: string; value?: string; operator?: string | number }>): JsonObject[] {
  return tags.map((entry) => ({
    tag: entry.tag,
    value: entry.value ?? "",
    operator: entry.operator ?? "0"
  }));
}

function zabbixTlsOptions(config: ZabbixConfig) {
  return config.tlsRejectUnauthorized === undefined && !config.caCert
    ? undefined
    : {
        rejectUnauthorized: config.tlsRejectUnauthorized,
        ca: config.caCert
      };
}

async function zabbixRpcWithConfig(config: ZabbixConfig, method: string, params: JsonObject, auth?: string): Promise<JsonObject> {
  const baseUrl = resolveBaseUrl(config);
  if (!baseUrl) {
    throw new Error("Zabbix baseUrl is missing");
  }
  const body: JsonObject = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params
  };
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (auth) {
    headers.authorization = `Bearer ${auth}`;
  }

  const response = await requestJson(buildUrl(baseUrl, "/api_jsonrpc.php"), {
    method: "POST",
    timeoutMs: config.timeoutMs ?? 15_000,
    tls: zabbixTlsOptions(config),
    headers,
    body
  });

  if (!isRecord(response)) {
    throw new Error(`Unexpected Zabbix response for ${method}`);
  }
  if (response.error) {
    const message = isRecord(response.error) && typeof response.error.message === "string" ? response.error.message : `Zabbix ${method} failed`;
    throw new Error(message);
  }
  if (!isRecord(response.result) && response.result !== null && response.result !== undefined) {
    return { result: response.result };
  }
  return response;
}

async function authenticate(config: ZabbixConfig, auth: ZabbixAuth): Promise<string | undefined> {
  if (auth.token) {
    return auth.token;
  }
  if (auth.sessionId) {
    return auth.sessionId;
  }
  if (!auth.username || !auth.password) {
    return undefined;
  }
  const response = await zabbixRpcWithConfig(config, "user.login", {
    username: auth.username,
    password: auth.password
  });
  return getString(response.result);
}

async function logout(config: ZabbixConfig, token: string): Promise<void> {
  try {
    await zabbixRpcWithConfig(config, "user.logout", {}, token);
  } catch {
    // Best-effort cleanup.
  }
}

function statusFromProblems(active: JsonObject[], suppressed: JsonObject[], fallback: StatusLevel): { status: StatusLevel; summary?: string } {
  const problems = active.length > 0 ? active : suppressed;
  if (problems.length === 0) {
    return { status: fallback };
  }
  if (suppressed.length > 0 && active.length === 0) {
    return { status: "maintenance", summary: `Zabbix maintenance affecting ${suppressed.length} problem(s)` };
  }
  const worst = problems.reduce<StatusLevel>((current, problem) => {
    const severity = typeof problem.severity === "number" ? problem.severity : Number(problem.severity ?? 0);
    const next = severityToStatus(Number.isFinite(severity) ? severity : 0);
    return worstStatus([current, next]);
  }, "healthy");
  return {
    status: worst,
    summary: problems[0] && typeof problems[0].name === "string" ? problems[0].name : `Zabbix detected ${problems.length} problem(s)`
  };
}

async function collectZabbixService(
  context: ConnectorCollectionContext,
  config: ZabbixConfig,
  authToken: string,
  service: ServiceDefinition,
  mapping: ZabbixMapping
): Promise<{ result?: ReturnType<typeof buildServiceResult>; fallbackStatus?: StatusLevel; fallbackSummary?: string }> {
  const baseUrl = resolveBaseUrl(config);
  if (!baseUrl) {
    return {};
  }

  const commonParams: JsonObject = {
    output: ["eventid", "name", "severity", "clock", "r_eventid", "objectid"],
    suppressed: false
  };

  if (config.hostIds && config.hostIds.length > 0) {
    commonParams.hostids = config.hostIds;
  }
  if (config.groupIds && config.groupIds.length > 0) {
    commonParams.groupids = config.groupIds;
  }
  if (config.tags && config.tags.length > 0) {
    commonParams.tags = buildTagFilters(config.tags);
  }
  if (config.severities && config.severities.length > 0) {
    commonParams.severities = config.severities;
  }
  if (typeof config.evaltype === "number") {
    commonParams.evaltype = config.evaltype;
  }

  if (mapping.hostIds && mapping.hostIds.length > 0) {
    commonParams.hostids = mapping.hostIds;
  }
  if (mapping.groupIds && mapping.groupIds.length > 0) {
    commonParams.groupids = mapping.groupIds;
  }
  if (mapping.tags && mapping.tags.length > 0) {
    commonParams.tags = mapping.tags.map((tag) => ({ tag, value: "", operator: 0 }));
  }
  if (mapping.severities && mapping.severities.length > 0) {
    commonParams.severities = mapping.severities;
  }
  if (typeof mapping.evaltype === "number") {
    commonParams.evaltype = mapping.evaltype;
  }

  const activeResponse = await zabbixRpcWithConfig(config, "problem.get", commonParams, authToken);
  const suppressedResponse = await zabbixRpcWithConfig(config, "problem.get", { ...commonParams, suppressed: true }, authToken);
  const activeProblems = Array.isArray(activeResponse.result) ? activeResponse.result.filter(isRecord) : [];
  const suppressedProblems = Array.isArray(suppressedResponse.result) ? suppressedResponse.result.filter(isRecord) : [];
  const fallback = mapping.healthySummary ?? config.summary ?? statusSummary(config.defaultStatus ?? "healthy");

  const computed = statusFromProblems(activeProblems, suppressedProblems, config.defaultStatus ?? "healthy");
  return {
    result: buildServiceResult({
      tenant: context.tenant,
      connector: context.connector,
      service,
      banners: context.banners,
      tabs: context.tabs,
      previousSnapshot: context.previousSnapshot,
      now: context.now,
      status: computed.status,
      summary: computed.summary ?? fallback
    })
  };
}

export async function collectZabbixConnector(context: ConnectorCollectionContext): Promise<ConnectorCollectionOutcome> {
  const config = parseJsonObject(context.connector.configJson) as ZabbixConfig;
  const auth = parseJsonObject(context.connector.authJson) as ZabbixAuth;

  if (config.mode === "demo" || !resolveBaseUrl(config)) {
    return demoConnectorOutcome(context, context.connector.configJson);
  }

  let token: string | undefined;
  try {
    token = await authenticate(config, auth);
    if (!token) {
      return {
        results: [],
        run: {
          connector: context.connector,
          status: "error",
          errorMessage: "Zabbix credentials are missing",
          touchedAt: nowIso()
        }
      };
    }

    const results = [];
    for (const service of context.services) {
      const mapping = resolveServiceMapping(service, config);
      if (!mapping) {
        continue;
      }
      const collected = await collectZabbixService(context, config, token, service, mapping);
      if (collected.result) {
        results.push(collected.result);
      }
    }

    return {
      results,
      run: {
        connector: context.connector,
        status: "success",
        touchedAt: context.now,
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
        errorMessage: error instanceof Error ? error.message : "Zabbix collection failed",
        touchedAt: nowIso()
      }
    };
  } finally {
    if (token && auth.username && auth.password) {
      await logout(config, token);
    }
  }
}
