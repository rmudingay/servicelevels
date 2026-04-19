import assert from "node:assert/strict";
import test from "node:test";
import { migrations, runMigrations } from "../src/store/migrations.js";

class FakeClient {
  applied: string[] = [];
  queries: Array<{ statement: string; values: unknown[] }> = [];

  async query(statement: string, values: unknown[] = []): Promise<unknown> {
    this.queries.push({ statement, values });

    if (statement.includes("SELECT id FROM schema_migrations")) {
      return { rows: this.applied.map((id) => ({ id })) };
    }

    if (statement.startsWith("INSERT INTO schema_migrations")) {
      this.applied.push(String(values[0]));
      return { rowCount: 1 };
    }

    return { rows: [] };
  }
}

test("runMigrations applies pending migrations once", async () => {
  const client = new FakeClient();
  await runMigrations(client);

  assert.equal(client.applied.length, migrations.length);
  assert.equal(client.queries.some((entry) => entry.statement === "BEGIN"), true);
  assert.equal(client.queries.some((entry) => entry.statement === "COMMIT"), true);

  const firstRunQueries = client.queries.length;
  await runMigrations(client);

  assert.equal(client.applied.length, migrations.length);
  assert.equal(client.queries.length > firstRunQueries, true);
  assert.equal(client.queries.filter((entry) => entry.statement === "BEGIN").length, migrations.length);
});
