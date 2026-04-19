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
