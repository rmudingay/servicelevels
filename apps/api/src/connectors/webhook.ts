import type { Banner, IntegrationConnector, ServiceDefinition, Snapshot, StatusLevel, TabDefinition, Tenant } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import { statusSummary } from "../store/utils.js";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome, JsonObject } from "./shared.js";
import {
  buildServiceResult,
  getString,
  getStringArray,
  isRecord,
  matchServiceDefinition,
  normalizeStatusFromText,
  parseJsonObject
} from "./shared.js";
import { demoConnectorOutcome } from "./demo.js";

type WebhookServiceUpdate = {
  service?: JsonObject;
  status?: StatusLevel;
  summary?: string;
  message?: string;
  note?: string;
};

type WebhookConfig = {
  sourceKey?: string;
  summary?: string;
  defaultStatus?: StatusLevel;
  secret?: string;
  services?: Array<
    JsonObject & {
      ref?: string;
      sourceRef?: string;
      slug?: string;
      name?: string;
      category?: string;
      topic?: string;
      tags?: string[];
      status?: StatusLevel;
      summary?: string;
    }
  >;
};

type ParsedWebhook = {
  overallStatus?: StatusLevel;
  summary?: string;
  updates: Array<{
    matcher: {
      ref?: string;
      sourceRef?: string;
      slug?: string;
      name?: string;
      category?: string;
      topic?: string;
      tags?: string[];
    };
    status: StatusLevel;
    summary?: string;
  }>;
};

function webhookConfig(configJson: string): WebhookConfig {
  return parseJsonObject(configJson) as WebhookConfig;
}

export function resolveWebhookConnector(connectors: IntegrationConnector[], source: string): IntegrationConnector | null {
  const normalized = source.trim().toLowerCase();
  const webhookConnectors = connectors.filter((connector) => connector.enabled && connector.type === "webhook");
  if (webhookConnectors.length === 0) {
    return null;
  }

  const matches = webhookConnectors.filter((connector) => {
    const config = webhookConfig(connector.configJson);
    const values = [connector.name, connector.id, config.sourceKey, config.sourceKey ? `source:${config.sourceKey}` : undefined].filter(Boolean) as string[];
    return values.some((value) => value.trim().toLowerCase() === normalized || value.toLowerCase().includes(normalized));
  });

  if (matches.length > 0) {
    return matches[0];
  }

  return webhookConnectors.length === 1 ? webhookConnectors[0] : null;
}

export function authorizeWebhookConnector(connector: IntegrationConnector, headers: Record<string, string>, token?: string): boolean {
  const config = webhookConfig(connector.configJson);
  if (!config.secret) {
    return true;
  }
  const headerSecret = headers["x-webhook-secret"] ?? headers["x-ess-webhook-secret"] ?? headers.authorization?.replace(/^Bearer\s+/i, "");
  return headerSecret === config.secret || token === config.secret;
}

function parseSingleUpdate(entry: JsonObject): ParsedWebhook["updates"][number] | null {
  const serviceMatcher = isRecord(entry.service) ? entry.service : entry;
  const statusValue =
    getString(entry.status) ??
    getString(entry.state) ??
    getString(serviceMatcher.status) ??
    getString(serviceMatcher.state) ??
    getString(serviceMatcher.severity) ??
    "";
  const status = normalizeStatusFromText(statusValue);
  const summary = getString(entry.summary) ?? getString(entry.message) ?? getString(entry.note) ?? getString(serviceMatcher.summary) ?? getString(serviceMatcher.message);
  const matcher = {
    ref: getString(entry.serviceId) ?? getString(serviceMatcher.serviceId) ?? getString(serviceMatcher.ref),
    sourceRef: getString(entry.sourceRef) ?? getString(serviceMatcher.sourceRef),
    slug: getString(entry.slug) ?? getString(serviceMatcher.slug),
    name: getString(entry.name) ?? getString(serviceMatcher.name),
    category: getString(entry.category) ?? getString(serviceMatcher.category),
    topic: getString(entry.topic) ?? getString(serviceMatcher.topic),
    tags: getStringArray(entry.tags ?? serviceMatcher.tags)
  };

  if (!matcher.ref && !matcher.sourceRef && !matcher.slug && !matcher.name && !matcher.category && !matcher.topic && matcher.tags.length === 0) {
    return null;
  }

  return {
    matcher,
    status,
    summary
  };
}

export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  if (!isRecord(payload)) {
    return { updates: [] };
  }

  const overallStatus = getString(payload.overallStatus ?? payload.status ?? payload.state)
    ? normalizeStatusFromText(getString(payload.overallStatus ?? payload.status ?? payload.state)!)
    : undefined;
  const summary = getString(payload.summary) ?? getString(payload.message) ?? getString(payload.note);
  const updates: ParsedWebhook["updates"] = [];

  if (Array.isArray(payload.services)) {
    for (const entry of payload.services.filter(isRecord)) {
      const parsed = parseSingleUpdate(entry);
      if (parsed) {
        updates.push(parsed);
      }
    }
  }

  if (isRecord(payload.service)) {
    const parsed = parseSingleUpdate(payload.service);
    if (parsed) {
      updates.push(parsed);
    }
  }

  if (isRecord(payload.serviceStatuses)) {
    for (const [key, value] of Object.entries(payload.serviceStatuses)) {
      const statusValue = typeof value === "string" ? value : isRecord(value) ? getString(value.status) ?? getString(value.state) ?? getString(value.severity) ?? "" : String(value ?? "");
      const summaryValue = isRecord(value) ? getString(value.summary) ?? getString(value.message) ?? getString(value.note) : undefined;
      if (!key) {
        continue;
      }
      updates.push({
        matcher: { ref: key, sourceRef: key, slug: key, name: key },
        status: normalizeStatusFromText(statusValue),
        summary: summaryValue
      });
    }
  }

  if (updates.length === 0) {
    const single = parseSingleUpdate(payload);
    if (single) {
      updates.push(single);
    }
  }

  return {
    overallStatus,
    summary,
    updates
  };
}

export async function collectWebhookConnector(context: ConnectorCollectionContext, payload: unknown): Promise<ConnectorCollectionOutcome> {
  const config = webhookConfig(context.connector.configJson);
  const parsed = parseWebhookPayload(payload);
  const touchedAt = nowIso();

  if (context.connector.type !== "webhook") {
    return demoConnectorOutcome(context, context.connector.configJson);
  }

  const defaultStatus = config.defaultStatus;
  if (defaultStatus && parsed.updates.length === 0) {
    const results = context.services.map((service) =>
      buildServiceResult({
        tenant: context.tenant,
        connector: context.connector,
        service,
        banners: context.banners,
        tabs: context.tabs,
        previousSnapshot: context.previousSnapshot,
        now: touchedAt,
        status: defaultStatus,
        summary: config.summary ?? statusSummary(defaultStatus)
      })
    );
    return {
      results,
      run: {
        connector: context.connector,
        status: "success",
        touchedAt
      },
      rawPayload: payload
    };
  }

  const results = context.services
    .map((service) => {
      const update = parsed.updates.find((entry) => matchServiceDefinition(service, entry.matcher));
      if (!update) {
        return null;
      }
      return buildServiceResult({
        tenant: context.tenant,
        connector: context.connector,
        service,
        banners: context.banners,
        tabs: context.tabs,
        previousSnapshot: context.previousSnapshot,
        now: touchedAt,
        status: update.status,
        summary: update.summary ?? parsed.summary ?? config.summary
      });
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return {
    results,
    run: {
      connector: context.connector,
      status: "success",
      touchedAt
    },
    rawPayload: payload
  };
}
