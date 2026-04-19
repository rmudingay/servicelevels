import type { ConnectorType } from "@service-levels/shared";
import type { ConnectorCollectionContext, ConnectorCollectionOutcome } from "./shared.js";
import { collectZabbixConnector } from "./zabbix.js";
import { collectPrometheusConnector } from "./prometheus.js";
import { collectPrtgConnector } from "./prtg.js";
import { demoConnectorOutcome } from "./demo.js";

export async function collectConnector(context: ConnectorCollectionContext): Promise<ConnectorCollectionOutcome> {
  switch (context.connector.type as ConnectorType) {
    case "zabbix":
      return collectZabbixConnector(context);
    case "prometheus":
      return collectPrometheusConnector(context);
    case "prtg":
      return collectPrtgConnector(context);
    case "webhook":
    default:
      return {
        results: [],
        run: {
          connector: context.connector,
          status: "success",
          touchedAt: context.now
        },
        rawPayload: {
          skipped: true,
          reason: "webhook connectors are ingress-only"
        }
      };
  }
}
