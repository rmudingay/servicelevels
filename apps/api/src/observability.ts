import type { FastifyInstance, FastifyRequest } from "fastify";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

type TimedRequest = FastifyRequest & {
  requestStartAt?: bigint;
};

const metricsPath = "/metrics";
const livePath = "/livez";
const readyPath = "/readyz";

const registry = new Registry();
let metricsRegistered = false;

const requestCounter = new Counter({
  name: "service_levels_http_requests_total",
  help: "Total number of HTTP requests handled by the API",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry]
});

const requestDuration = new Histogram({
  name: "service_levels_http_request_duration_seconds",
  help: "Duration of HTTP requests handled by the API",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

const appInfo = new Gauge({
  name: "service_levels_app_info",
  help: "Static information about the running application",
  labelNames: ["app_name"] as const,
  registers: [registry]
});

function routeLabel(request: FastifyRequest): string {
  return request.routeOptions.url || request.url.split("?")[0] || "unknown";
}

export function registerObservability(app: FastifyInstance, appName: string): void {
  if (!metricsRegistered) {
    collectDefaultMetrics({
      prefix: "service_levels_",
      register: registry
    });
    appInfo.labels(appName).set(1);
    metricsRegistered = true;
  }

  app.addHook("onRequest", async (request) => {
    (request as TimedRequest).requestStartAt = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = (request as TimedRequest).requestStartAt;
    if (!startedAt) {
      return;
    }

    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const labels = {
      method: request.method,
      route: routeLabel(request),
      status_code: String(reply.statusCode)
    };

    requestCounter.inc(labels, 1);
    requestDuration.observe(labels, elapsedSeconds);
  });

  app.get(livePath, async () => ({ ok: true }));
  app.get(readyPath, async () => ({ ok: true }));
  app.get(metricsPath, async (_request, reply) => {
    reply.type(registry.contentType).send(await registry.metrics());
  });
}
