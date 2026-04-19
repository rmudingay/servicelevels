import type { Banner, IntegrationConnector, ServiceDefinition, Snapshot, StatusLevel, TabDefinition, Tenant } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import { statusSummary } from "../store/utils.js";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome } from "./shared.js";
import { buildServiceResult, parseJsonObject } from "./shared.js";

type DemoConnectorConfig = {
  defaultStatus?: StatusLevel;
  summary?: string;
  simulateError?: boolean;
  errorMessage?: string;
  serviceStatuses?: Record<string, StatusLevel>;
  degradedServices?: string[];
  maintenanceServices?: string[];
  downServices?: string[];
};

function matchKeys(service: ServiceDefinition): string[] {
  return [service.slug, service.id, service.sourceRef, service.name];
}

function demoStatusForService(
  service: ServiceDefinition,
  previousSnapshot: Snapshot | null,
  connector: IntegrationConnector,
  config: DemoConnectorConfig
): { status: StatusLevel; summary?: string } {
  const previous = previousSnapshot?.services.find((entry) => entry.serviceId === service.id);
  const lookupKeys = matchKeys(service);
  const explicitStatus = lookupKeys.map((key) => config.serviceStatuses?.[key]).find(Boolean);
  const maintenanceService = lookupKeys.some((key) => config.maintenanceServices?.includes(key));
  const downService = lookupKeys.some((key) => config.downServices?.includes(key));
  const degradedService = lookupKeys.some((key) => config.degradedServices?.includes(key));

  let status: StatusLevel;
  if (maintenanceService) {
    status = "maintenance";
  } else if (downService) {
    status = "down";
  } else if (degradedService) {
    status = "degraded";
  } else if (explicitStatus) {
    status = explicitStatus;
  } else if (previous) {
    status = previous.status;
  } else if (config.defaultStatus) {
    status = config.defaultStatus;
  } else {
    status = connector ? "healthy" : "unknown";
  }

  return {
    status,
    summary: config.summary ?? previous?.summary ?? statusSummary(status)
  };
}

export function demoConnectorOutcome(context: ConnectorCollectionContext, configJson: string): ConnectorCollectionOutcome {
  const config = parseJsonObject(configJson) as DemoConnectorConfig;
  const touchedAt = nowIso();

  if (config.simulateError) {
    return {
      results: [],
      run: {
        connector: context.connector,
        status: "error",
        errorMessage: config.errorMessage ?? `Simulated error for ${context.connector.name}`,
        touchedAt
      }
    };
  }

  const results = context.services.map((service) => {
    const demo = demoStatusForService(service, context.previousSnapshot, context.connector, config);
    return buildServiceResult({
      tenant: context.tenant,
      connector: context.connector,
      service,
      banners: context.banners,
      tabs: context.tabs,
      previousSnapshot: context.previousSnapshot,
      now: touchedAt,
      status: demo.status,
      summary: demo.summary
    });
  });

  return {
    results,
    run: {
      connector: context.connector,
      status: "success",
      touchedAt
    }
  };
}
