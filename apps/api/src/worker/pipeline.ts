import type { Banner, IntegrationConnector, ServiceDefinition, Snapshot, TabDefinition, Tenant } from "@service-levels/shared";
import { nowIso } from "../utils.js";
import { statusSummary, worstStatus } from "../store/utils.js";
import type { StatusRepository } from "../store/types.js";
import type { ConnectorRun, ServiceResult } from "../connectors/shared.js";
import { bannerMatchesService } from "../connectors/shared.js";
import { collectConnector } from "../connectors/index.js";
import type { AppConfig } from "../config.js";
import { processStatusEvents } from "../notifications.js";
import { resolveEffectiveConfig } from "../settings.js";
import { authorizeWebhookConnector, collectWebhookConnector, parseWebhookPayload, resolveWebhookConnector } from "../connectors/webhook.js";
import type { JsonObject } from "../connectors/shared.js";

type TenantCycle = {
  tenant: Tenant;
  connectors: IntegrationConnector[];
  tabs: TabDefinition[];
  services: ServiceDefinition[];
  banners: Banner[];
  previousSnapshot: Snapshot | null;
  connectorRuns: ConnectorRun[];
  snapshot: Snapshot | null;
  changed: boolean;
};

function connectorMaintenanceIsActive(connector: IntegrationConnector, now: string): boolean {
  if (!connector.maintenanceEnabled) {
    return false;
  }
  const nowMs = Date.parse(now);
  const startsAtMs = connector.maintenanceStartAt ? Date.parse(connector.maintenanceStartAt) : Number.NEGATIVE_INFINITY;
  const endsAtMs = connector.maintenanceEndAt ? Date.parse(connector.maintenanceEndAt) : Number.POSITIVE_INFINITY;
  return nowMs >= startsAtMs && nowMs <= endsAtMs;
}

function connectorMaintenanceMessage(connector: IntegrationConnector): string {
  return connector.maintenanceMessage.trim() || `${connector.name} is in a planned maintenance interval.`;
}

function fingerprintSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({
    overallStatus: snapshot.overallStatus,
    services: snapshot.services.map((entry) => ({
      serviceId: entry.serviceId,
      status: entry.status,
      summary: entry.summary
    })),
  });
}

export async function collectTenantCycle(repo: StatusRepository, tenant: Tenant): Promise<TenantCycle> {
  const [services, connectors, banners, tabs, previousSnapshot] = await Promise.all([
    repo.getServices(tenant.id),
    repo.getConnectors(tenant.id),
    repo.getBanners(tenant.id),
    repo.getTabs(tenant.id),
    repo.getLatestSnapshot(tenant.id)
  ]);

  const enabledConnectors = connectors.filter((connector) => connector.enabled && connector.type !== "webhook");
  const connectorByType = new Map<IntegrationConnector["type"], IntegrationConnector>();
  for (const connector of enabledConnectors) {
    if (!connectorByType.has(connector.type)) {
      connectorByType.set(connector.type, connector);
    }
  }

  const connectorRuns: ConnectorRun[] = [];
  const serviceResults: ServiceResult[] = [];

  for (const connector of enabledConnectors) {
    const scopedServices = services.filter((service) => service.sourceType === connector.type && service.enabled);
    const cycleNow = nowIso();
    if (scopedServices.length === 0) {
      connectorRuns.push({
        connector,
        status: "success",
        touchedAt: cycleNow
      });
      continue;
    }

    if (connectorMaintenanceIsActive(connector, cycleNow)) {
      connectorRuns.push({
        connector,
        status: "success",
        touchedAt: cycleNow
      });
      serviceResults.push(
        ...scopedServices.map((service) => ({
          serviceId: service.id,
          status: "maintenance" as const,
          summary: connectorMaintenanceMessage(connector),
          lastCheckedAt: cycleNow,
          sourceConnectorId: connector.id,
          sourceConnectorType: connector.type,
          bannerIds: banners.filter((banner) => bannerMatchesService(banner, tenant, tabs, service)).map((banner) => banner.id)
        }))
      );
      continue;
    }

    const { results, run } = await collectConnector({
      tenant,
      connector,
      services: scopedServices,
      banners,
      tabs,
      previousSnapshot,
      now: nowIso()
    });
    connectorRuns.push(run);
    serviceResults.push(...results);
  }

  for (const service of services.filter((entry) => entry.enabled && !serviceResults.some((result) => result.serviceId === entry.id))) {
    const fallback = previousSnapshot?.services.find((entry) => entry.serviceId === service.id);
    serviceResults.push({
      serviceId: service.id,
      status: fallback?.status ?? "unknown",
      summary: fallback?.summary ?? (fallback ? statusSummary(fallback.status) : "Awaiting connector collection"),
      lastCheckedAt: nowIso(),
      sourceConnectorId: connectorByType.get(service.sourceType)?.id ?? null,
      sourceConnectorType: connectorByType.get(service.sourceType)?.type ?? null,
      bannerIds: banners.filter((banner) => bannerMatchesService(banner, tenant, tabs, service)).map((banner) => banner.id)
    });
  }

  const overallStatus = serviceResults.length > 0 ? worstStatus(serviceResults.map((entry) => entry.status)) : "unknown";
  const collectedAt = nowIso();

  const snapshot: Snapshot = {
    id: `snapshot-${tenant.id}-${Date.now()}`,
    tenantId: tenant.id,
    collectedAt,
    overallStatus,
    services: serviceResults
      .map(({ sourceConnectorId, sourceConnectorType, bannerIds, ...rest }) => rest)
      .sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
    rawPayload: {
      generatedBy: "worker",
      overallStatus,
      connectorRuns: connectorRuns.map((run) => ({
        connectorId: run.connector.id,
        connectorType: run.connector.type,
        status: run.status,
        errorMessage: run.errorMessage ?? null,
        touchedAt: run.touchedAt
      })),
      activeBannerIds: banners.filter((banner) => banner.active).map((banner) => banner.id)
    }
  };

  const changed = !previousSnapshot || fingerprintSnapshot(snapshot) !== fingerprintSnapshot(previousSnapshot);
  return {
    tenant,
    connectors: enabledConnectors,
    tabs,
    services,
    banners,
    previousSnapshot,
    connectorRuns,
    snapshot,
    changed
  };
}

export async function persistTenantCycle(config: AppConfig, repo: StatusRepository, cycle: TenantCycle): Promise<void> {
  if (cycle.snapshot) {
    await repo.saveSnapshot(cycle.snapshot);
    if (cycle.changed) {
      await processStatusEvents(await resolveEffectiveConfig(config, repo), repo, cycle.tenant, cycle.previousSnapshot, cycle.snapshot);
    }
  }

  const erroredConnectorIds = new Set(
    cycle.connectorRuns.filter((run) => run.status === "error").map((run) => run.connector.id)
  );

  for (const run of cycle.connectorRuns) {
    if (run.status === "error") {
      await repo.updateConnector(run.connector.id, {
        lastErrorAt: run.touchedAt,
        lastErrorMessage: run.errorMessage ?? "Connector collection failed"
      });
      continue;
    }

    if (!erroredConnectorIds.has(run.connector.id)) {
      await repo.updateConnector(run.connector.id, {
        lastSuccessAt: run.touchedAt,
        lastErrorAt: null,
        lastErrorMessage: null
      });
    }
  }
}

export async function collectAndPersistTenant(config: AppConfig, repo: StatusRepository, tenant: Tenant): Promise<TenantCycle> {
  const cycle = await collectTenantCycle(repo, tenant);
  await persistTenantCycle(config, repo, cycle);
  return cycle;
}

export async function ingestWebhookEvent(
  config: AppConfig,
  repo: StatusRepository,
  tenant: Tenant,
  source: string,
  payload: unknown,
  headers: Record<string, string> = {},
  token?: string
): Promise<{
  tenant: Tenant;
  connector: IntegrationConnector;
  snapshot: Snapshot;
}> {
  const [services, connectors, banners, tabs, previousSnapshot] = await Promise.all([
    repo.getServices(tenant.id),
    repo.getConnectors(tenant.id),
    repo.getBanners(tenant.id),
    repo.getTabs(tenant.id),
    repo.getLatestSnapshot(tenant.id)
  ]);

  const connector = resolveWebhookConnector(connectors, source);
  if (!connector) {
    throw new Error(`No webhook connector configured for source ${source}`);
  }

  if (!authorizeWebhookConnector(connector, headers, token)) {
    throw new Error("Webhook authentication failed");
  }

  const collectedAt = nowIso();
  if (connectorMaintenanceIsActive(connector, collectedAt)) {
    const serviceResults = services
      .filter((entry) => entry.enabled && entry.sourceType === connector.type)
      .map((service) => ({
        serviceId: service.id,
        status: "maintenance" as const,
        summary: connectorMaintenanceMessage(connector),
        lastCheckedAt: collectedAt,
        sourceConnectorId: connector.id,
        sourceConnectorType: connector.type,
        bannerIds: banners.filter((banner) => bannerMatchesService(banner, tenant, tabs, service)).map((banner) => banner.id)
      }));

    const overallStatus = serviceResults.length > 0 ? worstStatus(serviceResults.map((entry) => entry.status)) : "maintenance";
    const snapshot: Snapshot = {
      id: `snapshot-${tenant.id}-${Date.now()}`,
      tenantId: tenant.id,
      collectedAt,
      overallStatus,
      services: serviceResults
        .map(({ sourceConnectorId, sourceConnectorType, bannerIds, ...rest }) => rest)
        .sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
      rawPayload: {
        generatedBy: "webhook",
        source,
        connectorId: connector.id,
        overallStatus,
        maintenance: true,
        payload: payload as JsonObject
      }
    };

    await repo.saveSnapshot(snapshot);
    await processStatusEvents(await resolveEffectiveConfig(config, repo), repo, tenant, previousSnapshot, snapshot);
    await repo.updateConnector(connector.id, { lastSuccessAt: collectedAt, lastErrorAt: null, lastErrorMessage: null });

    return {
      tenant,
      connector,
      snapshot
    };
  }

  const parsed = parseWebhookPayload(payload);
  const outcome = await collectWebhookConnector(
    {
      tenant,
      connector,
      services,
      banners,
      tabs,
      previousSnapshot,
      now: nowIso()
    },
    payload
  );

  const matchedServiceIds = new Set(outcome.results.map((result) => result.serviceId));
  const serviceResults = [...outcome.results];

  if (serviceResults.length === 0 && parsed.overallStatus) {
    for (const service of services.filter((entry) => entry.enabled)) {
      const previous = previousSnapshot?.services.find((entry) => entry.serviceId === service.id);
      serviceResults.push({
        serviceId: service.id,
        status: previous?.status ?? parsed.overallStatus,
        summary: previous?.summary ?? parsed.summary ?? statusSummary(previous?.status ?? parsed.overallStatus),
        lastCheckedAt: collectedAt,
        sourceConnectorId: connector.id,
        sourceConnectorType: connector.type,
        bannerIds: banners.filter((banner) => bannerMatchesService(banner, tenant, tabs, service)).map((banner) => banner.id)
      });
    }
  }

  for (const service of services.filter((entry) => entry.enabled && !matchedServiceIds.has(entry.id) && !serviceResults.some((result) => result.serviceId === entry.id))) {
    const fallback = previousSnapshot?.services.find((entry) => entry.serviceId === service.id);
    serviceResults.push({
      serviceId: service.id,
      status: fallback?.status ?? "unknown",
      summary: fallback?.summary ?? (fallback ? statusSummary(fallback.status) : "Awaiting webhook update"),
      lastCheckedAt: collectedAt,
      sourceConnectorId: connector.id,
      sourceConnectorType: connector.type,
      bannerIds: banners.filter((banner) => bannerMatchesService(banner, tenant, tabs, service)).map((banner) => banner.id)
    });
  }

  if (serviceResults.length === 0) {
    throw new Error("Webhook payload did not match any services");
  }

  const overallStatus = parsed.overallStatus ?? worstStatus(serviceResults.map((entry) => entry.status));
  const snapshot: Snapshot = {
    id: `snapshot-${tenant.id}-${Date.now()}`,
    tenantId: tenant.id,
    collectedAt,
    overallStatus,
    services: serviceResults
      .map(({ sourceConnectorId, sourceConnectorType, bannerIds, ...rest }) => rest)
      .sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
    rawPayload: {
      generatedBy: "webhook",
      source,
      connectorId: connector.id,
      overallStatus,
      payload: payload as JsonObject
    }
  };

  await repo.saveSnapshot(snapshot);
  await processStatusEvents(await resolveEffectiveConfig(config, repo), repo, tenant, previousSnapshot, snapshot);
  await repo.updateConnector(connector.id, { lastSuccessAt: collectedAt, lastErrorAt: null, lastErrorMessage: null });

  return {
    tenant,
    connector,
    snapshot
  };
}
