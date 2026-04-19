import type { ServiceDefinition } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome, JsonObject } from "./shared.js";
import {
  buildServiceResult,
  buildUrl,
  getNumber,
  getString,
  isRecord,
  parseJsonObject,
  prtgStatusToStatus,
  requestJson
} from "./shared.js";
import { demoConnectorOutcome } from "./demo.js";

type PrtgMapping = {
  ref?: string;
  objid?: string | number;
  group?: string;
  device?: string;
  sensor?: string;
  summary?: string;
};

type PrtgConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  mode?: "demo" | "table";
  summary?: string;
  apiToken?: string;
  username?: string;
  password?: string;
  passhash?: string;
  services?: PrtgMapping[];
};

type PrtgAuth = {
  apiToken?: string;
  username?: string;
  password?: string;
  passhash?: string;
};

function resolveBaseUrl(config: PrtgConfig): string | undefined {
  return config.baseUrl?.trim() || undefined;
}

function resolveServiceMapping(service: ServiceDefinition, config: PrtgConfig): PrtgMapping {
  const services = config.services ?? [];
  const candidates = services.filter((entry) => {
    const keys = [entry.ref, String(entry.objid ?? ""), entry.group, entry.device, entry.sensor];
    return keys.some((key) => key && [service.id, service.slug, service.sourceRef, service.name].some((candidate) => candidate === key || candidate.includes(key)));
  });
  return candidates[0] ?? {
    ref: service.sourceRef,
    sensor: service.name,
    summary: config.summary
  };
}

function buildAuthQuery(config: PrtgConfig, auth: PrtgAuth): Record<string, string> {
  const result: Record<string, string> = {};
  const apiToken = auth.apiToken ?? config.apiToken;
  if (apiToken) {
    result.apitoken = apiToken;
    return result;
  }

  const username = auth.username ?? config.username;
  const passhash = auth.passhash ?? config.passhash;
  const password = auth.password ?? config.password;
  if (username && passhash) {
    result.username = username;
    result.passhash = passhash;
    return result;
  }
  if (username && password) {
    result.username = username;
    result.password = password;
  }
  return result;
}

function unwrapRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload)) {
    if (Array.isArray(payload.result)) {
      return payload.result.filter(isRecord);
    }
    if (isRecord(payload.prtg) && Array.isArray(payload.prtg.result)) {
      return payload.prtg.result.filter(isRecord);
    }
    if (Array.isArray(payload.data)) {
      return payload.data.filter(isRecord);
    }
  }
  return [];
}

function matchesRow(row: JsonObject, mapping: PrtgMapping): boolean {
  const objid = getString(row.objid) ?? String(getNumber(row.objid) ?? "");
  if (mapping.objid && String(mapping.objid) === objid) {
    return true;
  }

  const values = [row.group, row.device, row.sensor, row.name, row.message, row.status, row.lastvalue]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter(Boolean);

  const serviceKeys = [mapping.ref, mapping.group, mapping.device, mapping.sensor].filter(Boolean) as string[];
  if (serviceKeys.length === 0) {
    return false;
  }

  return serviceKeys.some((needle) =>
    values.some((entry) => entry.toLowerCase() === needle.toLowerCase() || entry.toLowerCase().includes(needle.toLowerCase()))
  );
}

function summarizeRow(row: JsonObject, mapping: PrtgMapping): string {
  const message = getString(row.message);
  if (message) {
    return message;
  }
  const lastValue = getString(row.lastvalue);
  if (lastValue) {
    return `${mapping.sensor ?? mapping.ref ?? "PRTG sensor"} reports ${lastValue}`;
  }
  return mapping.summary ?? `PRTG status for ${mapping.sensor ?? mapping.ref ?? "sensor"}`;
}

async function collectPrtgTable(baseUrl: string, config: PrtgConfig, auth: PrtgAuth): Promise<JsonObject[]> {
  const query = {
    content: "sensors",
    columns: "objid,group,device,sensor,status,message,lastvalue,priority",
    ...buildAuthQuery(config, auth)
  };
  const response = await requestJson(buildUrl(baseUrl, "/api/table.json", query), {
    timeoutMs: config.timeoutMs ?? 15_000
  });
  return unwrapRows(response);
}

export async function collectPrtgConnector(context: ConnectorCollectionContext): Promise<ConnectorCollectionOutcome> {
  const config = parseJsonObject(context.connector.configJson) as PrtgConfig;
  const auth = parseJsonObject(context.connector.authJson) as PrtgAuth;

  if (config.mode === "demo" || !resolveBaseUrl(config)) {
    return demoConnectorOutcome(context, context.connector.configJson);
  }

  try {
    const baseUrl = resolveBaseUrl(config)!;
    const rows = await collectPrtgTable(baseUrl, config, auth);
    const results = [];

    for (const service of context.services) {
      const mapping = resolveServiceMapping(service, config);
      const row = rows.find((entry) => matchesRow(entry, mapping));
      if (!row) {
        continue;
      }

      const status = prtgStatusToStatus(getString(row.status) ?? "");
      results.push(
        buildServiceResult({
          tenant: context.tenant,
          connector: context.connector,
          service,
          banners: context.banners,
          tabs: context.tabs,
          previousSnapshot: context.previousSnapshot,
          now: context.now,
          status,
          summary: summarizeRow(row, mapping)
        })
      );
    }

    return {
      results,
      run: {
        connector: context.connector,
        status: "success",
        touchedAt: context.now
      },
      rawPayload: {
        collectedRows: rows.length
      }
    };
  } catch (error) {
    return {
      results: [],
      run: {
        connector: context.connector,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "PRTG collection failed",
        touchedAt: nowIso()
      }
    };
  }
}
