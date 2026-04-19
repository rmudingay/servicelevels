import { loadConfig } from "./config.js";
import { createRepository } from "./store/index.js";
import { collectAndPersistTenant } from "./worker/pipeline.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runLoop(): Promise<void> {
  const config = loadConfig();
  const { repo, close } = await createRepository(config);
  const tickMs = Math.max(60, config.workerTickSeconds) * 1000;
  let stopping = false;

  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await close();
  };

  process.on("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  while (!stopping) {
    try {
      const tenants = await repo.getTenants();
      for (const tenant of tenants.filter((entry) => entry.enabled)) {
        const cycle = await collectAndPersistTenant(config, repo, tenant);
        console.info(
          JSON.stringify({
            at: new Date().toISOString(),
            tenant: tenant.slug,
            snapshotCreated: Boolean(cycle.snapshot),
            overallStatus: cycle.snapshot?.overallStatus ?? cycle.previousSnapshot?.overallStatus ?? "unknown",
            connectorRuns: cycle.connectorRuns.map((run) => ({
              connector: run.connector.name,
              type: run.connector.type,
              status: run.status
            }))
          })
        );
      }
    } catch (error) {
      console.error("worker cycle failed", error);
    }

    await sleep(tickMs);
  }
}

void runLoop();
