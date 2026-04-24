export type Migration = {
  id: string;
  statements: string[];
};

export const migrations: Migration[] = [
  {
    id: "001_initial_schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        id integer PRIMARY KEY DEFAULT 1,
        app_name text NOT NULL,
        logo_url text NOT NULL DEFAULT '',
        favicon_url text NOT NULL DEFAULT '',
        theme_default text NOT NULL DEFAULT 'dark'
      )`,
      `CREATE TABLE IF NOT EXISTS tenants (
        id text PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true
      )`,
      `CREATE TABLE IF NOT EXISTS tabs (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title text NOT NULL,
        slug text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        filter_query text NOT NULL DEFAULT '',
        is_global boolean NOT NULL DEFAULT false,
        enabled boolean NOT NULL DEFAULT true
      )`,
      `CREATE TABLE IF NOT EXISTS services (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        slug text NOT NULL,
        category text NOT NULL DEFAULT '',
        topic text NOT NULL DEFAULT '',
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        source_type text NOT NULL,
        source_ref text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true
      )`,
      `CREATE TABLE IF NOT EXISTS connectors (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        type text NOT NULL,
        name text NOT NULL,
        config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        auth_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        poll_interval_seconds integer NOT NULL DEFAULT 300,
        last_success_at timestamptz NULL,
        last_error_at timestamptz NULL
      )`,
      `CREATE TABLE IF NOT EXISTS banners (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        scope_type text NOT NULL,
        scope_ref text NOT NULL DEFAULT '',
        title text NOT NULL,
        message text NOT NULL,
        severity text NOT NULL,
        starts_at timestamptz NULL,
        ends_at timestamptz NULL,
        active boolean NOT NULL DEFAULT true
      )`,
      `CREATE TABLE IF NOT EXISTS incidents (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        service_id text NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'open',
        opened_at timestamptz NOT NULL,
        resolved_at timestamptz NULL,
        source_type text NOT NULL DEFAULT 'manual'
      )`,
      `CREATE TABLE IF NOT EXISTS maintenance_windows (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        service_id text NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL DEFAULT '',
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NULL,
        status text NOT NULL DEFAULT 'scheduled',
        created_by text NOT NULL DEFAULT 'system'
      )`,
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        service_id text NULL REFERENCES services(id) ON DELETE CASCADE,
        channel_type text NOT NULL,
        target text NOT NULL,
        enabled boolean NOT NULL DEFAULT true
      )`,
      `CREATE TABLE IF NOT EXISTS colors (
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        status_key text NOT NULL,
        color_hex text NOT NULL,
        label text NOT NULL,
        PRIMARY KEY (tenant_id, status_key)
      )`,
      `CREATE TABLE IF NOT EXISTS snapshots (
        id text PRIMARY KEY,
        tenant_id text NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        collected_at timestamptz NOT NULL,
        overall_status text NOT NULL,
        services jsonb NOT NULL DEFAULT '[]'::jsonb,
        raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
      )`,
      `CREATE TABLE IF NOT EXISTS daily_status_summaries (
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        day text NOT NULL,
        overall_status text NOT NULL,
        seconds_by_status jsonb NOT NULL DEFAULT '{}'::jsonb,
        first_collected_at timestamptz NOT NULL,
        last_collected_at timestamptz NOT NULL,
        sample_count integer NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, day)
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        username text NOT NULL UNIQUE,
        display_name text NOT NULL DEFAULT '',
        email text NOT NULL DEFAULT '',
        auth_type text NOT NULL,
        is_admin boolean NOT NULL DEFAULT false,
        enabled boolean NOT NULL DEFAULT true,
        password_hash text NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tabs_tenant_sort ON tabs (tenant_id, sort_order, title)`,
      `CREATE INDEX IF NOT EXISTS idx_services_tenant_name ON services (tenant_id, name)`,
      `CREATE INDEX IF NOT EXISTS idx_connectors_tenant_name ON connectors (tenant_id, name)`,
      `CREATE INDEX IF NOT EXISTS idx_banners_tenant_active ON banners (tenant_id, active, title)`,
      `CREATE INDEX IF NOT EXISTS idx_incidents_tenant_opened ON incidents (tenant_id, opened_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_maintenance_tenant_starts ON maintenance_windows (tenant_id, starts_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_collected ON snapshots (tenant_id, collected_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_daily_summaries_tenant_day ON daily_status_summaries (tenant_id, day DESC)`
    ]
  },
  {
    id: "002_platform_settings",
    statements: [
      `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS auth_settings_json jsonb`,
      `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS notification_settings_json jsonb`
    ]
  }
];

type MigrationClient = {
  query(statement: string, values?: unknown[]): Promise<unknown>;
};

export async function runMigrations(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const result = (await client.query("SELECT id FROM schema_migrations ORDER BY id")) as { rows?: Array<{ id: string }> };
  const applied = new Set((result.rows ?? []).map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await client.query("BEGIN");
    try {
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}
