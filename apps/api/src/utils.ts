export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function worstStatus(values: Array<"healthy" | "degraded" | "down" | "maintenance" | "unknown">): "healthy" | "degraded" | "down" | "maintenance" | "unknown" {
  const order = ["unknown", "maintenance", "down", "degraded", "healthy"] as const;
  return values.reduce((current, next) => (order.indexOf(next) < order.indexOf(current) ? next : current), "healthy");
}

export function scopeKey(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(":");
}

