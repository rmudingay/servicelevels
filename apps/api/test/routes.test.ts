import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("status API exposes the current snapshot and daily summaries", async () => {
  const app = await buildApp(loadConfig({}));
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/status?tenant=primary-site"
    });

    assert.equal(response.statusCode, 200);

    const body = response.json() as { snapshot?: { id: string }; dailySummaries?: Array<{ day: string }> };
    assert.equal(Boolean(body.snapshot), true);
    assert.equal(Array.isArray(body.dailySummaries), true);
    assert.equal(body.dailySummaries?.length > 0, true);
  } finally {
    await app.close();
  }
});

test("observability endpoints expose liveness, readiness, and Prometheus metrics", async () => {
  const app = await buildApp(loadConfig({}));
  try {
    const live = await app.inject({
      method: "GET",
      url: "/livez"
    });
    const ready = await app.inject({
      method: "GET",
      url: "/readyz"
    });
    const metrics = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    assert.equal(live.statusCode, 200);
    assert.equal(ready.statusCode, 200);
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /service_levels_http_requests_total/);
    assert.match(metrics.body, /service_levels_app_info/);
  } finally {
    await app.close();
  }
});
