import type { Snapshot, StatusLevel } from "@service-levels/shared";

export function statusSummary(status: StatusLevel): string {
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

export function worstStatus(values: Array<StatusLevel>): StatusLevel {
  const order = ["unknown", "maintenance", "down", "degraded", "healthy"] as const;
  return values.reduce((current, next) => (order.indexOf(next) < order.indexOf(current) ? next : current), "healthy");
}

export function mergeSummaryStatus(current: StatusLevel, next: StatusLevel): StatusLevel {
  if (current === "unknown") {
    return next;
  }
  if (next === "unknown") {
    return current;
  }
  return worstStatus([current, next]);
}

export function statusRank(status: StatusLevel): number {
  switch (status) {
    case "healthy":
      return 0;
    case "degraded":
      return 1;
    case "maintenance":
      return 2;
    case "down":
      return 3;
    default:
      return 4;
  }
}

export function severityTrend(previous: StatusLevel, next: StatusLevel): "improved" | "worse" | "unchanged" {
  const previousRank = statusRank(previous);
  const nextRank = statusRank(next);
  if (nextRank < previousRank) {
    return "improved";
  }
  if (nextRank > previousRank) {
    return "worse";
  }
  return "unchanged";
}

export function snapshotHash(snapshot: Snapshot): string {
  return JSON.stringify({
    tenantId: snapshot.tenantId,
    collectedAt: snapshot.collectedAt,
    overallStatus: snapshot.overallStatus,
    services: snapshot.services.map((entry) => ({
      serviceId: entry.serviceId,
      status: entry.status,
      summary: entry.summary,
      lastCheckedAt: entry.lastCheckedAt
    }))
  });
}

export function utcDayKey(value: string): string {
  return value.slice(0, 10);
}

export function splitUtcIntervalByDay(
  startIso: string,
  endIso: string
): Array<{ day: string; seconds: number; segmentStart: string; segmentEnd: string }> {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }

  const results: Array<{ day: string; seconds: number; segmentStart: string; segmentEnd: string }> = [];
  let cursor = start;
  while (cursor < end) {
    const current = new Date(cursor);
    const dayStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
    const nextDay = dayStart + 24 * 60 * 60 * 1000;
    const intervalEnd = Math.min(end, nextDay);
    results.push({
      day: current.toISOString().slice(0, 10),
      seconds: Math.max(0, (intervalEnd - cursor) / 1000),
      segmentStart: new Date(cursor).toISOString(),
      segmentEnd: new Date(intervalEnd).toISOString()
    });
    cursor = intervalEnd;
  }

  return results;
}
