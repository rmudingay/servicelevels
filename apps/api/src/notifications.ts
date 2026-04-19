import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";
import type { StatusRepository } from "./store/types.js";
import type { Banner, Incident, MaintenanceWindow, ServiceDefinition, Snapshot, StatusLevel, Tenant } from "@service-levels/shared";
import { nowIso } from "./utils.js";

type StatusEvent =
  | { kind: "incident-opened"; service: ServiceDefinition; incident: Incident }
  | { kind: "incident-resolved"; service: ServiceDefinition; incident: Incident }
  | { kind: "maintenance-started"; service: ServiceDefinition; maintenance: MaintenanceWindow }
  | { kind: "maintenance-resolved"; service: ServiceDefinition; maintenance: MaintenanceWindow };

type NotificationTestOverrides = {
  deliverSlack?: (webhookUrl: string, text: string) => Promise<void>;
  deliverEmail?: (config: AppConfig, to: string, subject: string, text: string) => Promise<void>;
};

let notificationTestOverrides: NotificationTestOverrides | null = null;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function statusSummary(status: StatusLevel): string {
  switch (status) {
    case "healthy":
      return "Operating normally";
    case "degraded":
      return "Degraded service";
    case "down":
      return "Service unavailable";
    case "maintenance":
      return "Scheduled maintenance";
    default:
      return "Status unavailable";
  }
}

function matchTenantSlug(tenant: Tenant, tenantSlug?: string): boolean {
  return !tenantSlug || tenant.slug === tenantSlug;
}

function buildItem(title: string, description: string, guid: string, pubDate: string): string {
  return `
    <item>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(description)}</description>
      <guid>${escapeXml(guid)}</guid>
      <pubDate>${escapeXml(pubDate)}</pubDate>
    </item>`;
}

export async function buildStatusFeed(config: AppConfig, store: StatusRepository, tenantSlug?: string): Promise<string> {
  const view = await store.getStatusView(tenantSlug);
  const tenant = view.tenants[0];
  const items: string[] = [];

  if (view.snapshot) {
    items.push(
      buildItem(
        `Current status: ${view.snapshot.overallStatus}`,
        `Overall status is ${view.snapshot.overallStatus} as of ${view.snapshot.collectedAt}`,
        view.snapshot.id,
        view.snapshot.collectedAt
      )
    );
  }

  for (const incident of view.incidents.filter((entry) => entry.status === "open")) {
    items.push(
      buildItem(
        `Incident: ${incident.title}`,
        incident.description,
        incident.id,
        incident.openedAt
      )
    );
  }

  for (const maintenance of view.maintenance.filter((entry) => entry.status !== "resolved")) {
    items.push(
      buildItem(
        `Maintenance: ${maintenance.title}`,
        maintenance.description,
        maintenance.id,
        maintenance.startsAt
      )
    );
  }

  for (const banner of view.banners.filter((entry) => entry.active)) {
    items.push(buildItem(`Banner: ${banner.title}`, banner.message, banner.id, banner.startsAt ?? nowIso()));
  }

  const channelTitle = tenant ? `${view.meta.appName} - ${tenant.name}` : view.meta.appName;
  const description = tenant ? `Status feed for ${tenant.name}` : "Service status feed";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <description>${escapeXml(description)}</description>
    <link>${escapeXml(new URL("/", config.appBaseUrl).toString())}</link>
    ${items.join("")}
  </channel>
</rss>`;
}

export function setNotificationTestOverrides(overrides: NotificationTestOverrides | null): void {
  notificationTestOverrides = overrides;
}

function composeEventMessage(event: StatusEvent): string {
  switch (event.kind) {
    case "incident-opened":
      return `${event.service.name}: incident opened - ${event.incident.title}`;
    case "incident-resolved":
      return `${event.service.name}: incident resolved - ${event.incident.title}`;
    case "maintenance-started":
      return `${event.service.name}: maintenance started - ${event.maintenance.title}`;
    case "maintenance-resolved":
      return `${event.service.name}: maintenance resolved - ${event.maintenance.title}`;
  }
}

async function deliverSlack(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) {
    return;
  }
  await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ text })
  });
}

async function deliverEmail(config: AppConfig, to: string, subject: string, text: string): Promise<void> {
  if (!config.notifications.smtpHost || !config.notifications.smtpFrom || !to) {
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.notifications.smtpHost,
    port: config.notifications.smtpPort,
    secure: config.notifications.smtpPort === 465,
    auth: config.notifications.smtpUser
      ? {
          user: config.notifications.smtpUser,
          pass: config.notifications.smtpPassword
        }
      : undefined
  });

  await transport.sendMail({
    from: config.notifications.smtpFrom,
    to,
    subject,
    text
  });
}

export async function processStatusEvents(
  config: AppConfig,
  store: StatusRepository,
  tenant: Tenant,
  previousSnapshot: Snapshot | null,
  snapshot: Snapshot
): Promise<void> {
  const slackDelivery = notificationTestOverrides?.deliverSlack ?? deliverSlack;
  const emailDelivery = notificationTestOverrides?.deliverEmail ?? deliverEmail;
  const services = await store.getServices(tenant.id);
  const incidents = await store.getIncidents(tenant.id);
  const maintenanceWindows = await store.getMaintenanceWindows(tenant.id);
  const subscriptions = await store.getSubscriptions(tenant.id);
  const events: StatusEvent[] = [];

  for (const service of services.filter((entry) => entry.enabled)) {
    const previousStatus = (previousSnapshot?.services.find((entry) => entry.serviceId === service.id)?.status ?? "unknown") as StatusLevel;
    const currentStatus = (snapshot.services.find((entry) => entry.serviceId === service.id)?.status ?? "unknown") as StatusLevel;
    const activeIncident = incidents.find((incident) => incident.serviceId === service.id && incident.status === "open");
    const activeMaintenance = maintenanceWindows.find((entry) => entry.serviceId === service.id && entry.status !== "resolved");

    if (String(currentStatus) === "maintenance" || (String(currentStatus) === "unknown" && activeMaintenance)) {
      if (!activeMaintenance) {
        const maintenance = await store.createMaintenanceWindow(tenant.id, {
          serviceId: service.id,
          title: `${service.name} maintenance`,
          description: `${service.name} entered maintenance based on collected status.`,
          startsAt: snapshot.collectedAt,
          endsAt: null,
          status: "active",
          createdBy: "system"
        });
        events.push({ kind: "maintenance-started", service, maintenance });
      }
      continue;
    }

    if (activeMaintenance && previousStatus === "maintenance" && currentStatus !== "maintenance") {
      const resolved = await store.resolveMaintenanceWindow(activeMaintenance.id, snapshot.collectedAt);
      if (resolved) {
        events.push({ kind: "maintenance-resolved", service, maintenance: resolved });
      }
    }

    if (currentStatus === "down" || currentStatus === "degraded") {
      if (!activeIncident) {
        const incident = await store.createIncident(tenant.id, {
          serviceId: service.id,
          title: `${service.name} ${currentStatus}`,
          description: `${service.name} reported ${currentStatus} in the latest snapshot.`,
          status: "open",
          openedAt: snapshot.collectedAt,
          resolvedAt: null,
          sourceType: service.sourceType
        });
        events.push({ kind: "incident-opened", service, incident });
      }
      continue;
    }

    if (activeIncident && previousStatus !== "healthy" && currentStatus === "healthy") {
      const resolved = await store.resolveIncident(activeIncident.id, snapshot.collectedAt);
      if (resolved) {
        events.push({ kind: "incident-resolved", service, incident: resolved });
      }
    }
  }

  if (events.length === 0) {
    return;
  }

  const combinedMessage = events.map((event) => composeEventMessage(event)).join("\n");

  for (const subscription of subscriptions.filter((entry) => entry.enabled)) {
    const matchingEvents = events.filter((event) => !subscription.serviceId || event.service.id === subscription.serviceId);
    if (matchingEvents.length === 0) {
      continue;
    }
    const combinedMessage = matchingEvents.map((event) => composeEventMessage(event)).join("\n");
    if (subscription.channelType === "slack") {
      await slackDelivery(subscription.target, combinedMessage);
    } else if (subscription.channelType === "email") {
      await emailDelivery(config, subscription.target, `${config.appName}: status update`, combinedMessage);
    }
  }

  if (config.notifications.slackWebhookUrl) {
    await slackDelivery(config.notifications.slackWebhookUrl, combinedMessage);
  }
}
