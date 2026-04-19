import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function readCoverageSummary(filePath) {
  const json = JSON.parse(readFileSync(filePath, "utf8"));
  return json.total;
}

function badgeColor(percentage) {
  if (percentage >= 90) {
    return "brightgreen";
  }
  if (percentage >= 80) {
    return "green";
  }
  if (percentage >= 70) {
    return "yellowgreen";
  }
  if (percentage >= 60) {
    return "yellow";
  }
  if (percentage >= 50) {
    return "orange";
  }
  return "red";
}

function writeBadge(outputPath, label, percentage) {
  const rounded = Number(percentage.toFixed(2));
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        label,
        message: `${rounded}%`,
        color: badgeColor(rounded)
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

const root = process.cwd();
const outputDir = resolve(root, ".badges");
mkdirSync(outputDir, { recursive: true });

const apiSummary = readCoverageSummary(resolve(root, "apps/api/coverage/coverage-summary.json"));
const webSummary = readCoverageSummary(resolve(root, "apps/web/coverage/coverage-summary.json"));

writeBadge(resolve(outputDir, "api-coverage.json"), "API coverage", apiSummary.statements.pct);
writeBadge(resolve(outputDir, "web-coverage.json"), "Web coverage", webSummary.statements.pct);
