import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig resolves *_FILE secret overrides", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "service-levels-config-"));
  const jwtSecretFile = join(tempDir, "jwt-secret");
  const databaseUrlFile = join(tempDir, "database-url");
  const smtpPasswordFile = join(tempDir, "smtp-password");

  writeFileSync(jwtSecretFile, "secret-from-file\n");
  writeFileSync(databaseUrlFile, "postgresql://user:pass@db:5432/app\n");
  writeFileSync(smtpPasswordFile, "smtp-secret\n");

  const config = loadConfig({
    JWT_SECRET_FILE: jwtSecretFile,
    DATABASE_URL_FILE: databaseUrlFile,
    SMTP_PASSWORD_FILE: smtpPasswordFile
  });

  assert.equal(config.jwtSecret, "secret-from-file");
  assert.equal(config.databaseUrl, "postgresql://user:pass@db:5432/app");
  assert.equal(config.notifications.smtpPassword, "smtp-secret");
});
