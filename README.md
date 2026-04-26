# Service Levels application

![API coverage](https://img.shields.io/endpoint?cacheSeconds=300&url=https%3A%2F%2Fraw.githubusercontent.com%2Frmudingay%2Fservicelevels%2Fbadges%2Fbadges%2Fapi-coverage.json)
![Web coverage](https://img.shields.io/endpoint?cacheSeconds=300&url=https%3A%2F%2Fraw.githubusercontent.com%2Frmudingay%2Fservicelevels%2Fbadges%2Fbadges%2Fweb-coverage.json)

Service Levels application is a multi-tenant status application for monitored environments. It provides a public status page, an authenticated admin console, scheduled collection from monitoring platforms, and a normalized status model for presenting high-level service health without querying monitoring backends directly from the browser.

The current implementation includes:
- React frontend for the public status page and `/admin`
- Node.js backend API
- PostgreSQL-backed persistence with migrations
- background worker for collection and event processing
- integrations for Zabbix, Prometheus, PRTG, and inbound webhooks
- RSS, Slack, and email notification support
- local, LDAP, and browser redirect-based SSO auth flows

## Repository Layout

- `apps/api`: backend API, worker, routes, auth, connectors, and tests
- `apps/web`: React frontend
- `packages/shared`: shared types and contracts
- `docs`: architecture, data model, API, implementation plan, and handoff notes

## Planning And Design Docs

- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)
- [API Surface](docs/api.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Session Handoff](docs/session-handoff.md)

## Deployment

### Docker Compose

The repository includes a ready-to-run `docker-compose.yml` with:
- `db`: PostgreSQL 16 with a persistent named volume, `servicelevels_db_data`
- `app`: API and frontend delivery on port `8080`
- `worker`: scheduled collector and notification processor

Start the stack with the default pinned application image version (`v0.2.0`):

```bash
podman compose pull
podman compose up -d
```

To run a different published version, set `SERVICELEVELS_VERSION` before starting the stack:

```bash
SERVICELEVELS_VERSION=v0.2.0 podman compose up -d
```

For a persistent deployment setting, place the version in a local `.env` file:

```env
SERVICELEVELS_VERSION=v0.2.0
```

Release images are published from Git tags to GitHub Container Registry:

```bash
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

The compose file uses `ghcr.io/rmudingay/servicelevels:${SERVICELEVELS_VERSION}` for both the API/frontend container and the worker container. To upgrade, change `SERVICELEVELS_VERSION`, then run:

```bash
podman compose pull
podman compose up -d
```

Database settings and application configuration are stored in PostgreSQL. The compose file mounts PostgreSQL data into the named volume `servicelevels_db_data`, so normal application image upgrades do not reset tenants, connectors, banners, authentication settings, or other stored configuration.

Do not use `podman compose down -v` unless you intentionally want to delete the database volume. If you previously ran an older compose file without a database volume, export the database before removing the old `db` container:

```bash
podman exec <db-container-name> pg_dump -U service_levels service_levels > service_levels_backup.sql
```

After starting the updated compose stack, restore the backup if needed:

```bash
podman exec -i <db-container-name> psql -U service_levels service_levels < service_levels_backup.sql
```

The default endpoints are:
- public status page: `http://localhost:8080/`
- admin UI: `http://localhost:8080/admin`

Default bootstrap environment in `docker-compose.yml` includes:
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=change-me`
- `PUBLIC_AUTH_MODE=public`

These defaults are suitable only for local development. Change them before any shared or production deployment.

### Environment And Runtime Notes

The API and worker use the same configuration model. Common settings include:
- `DATABASE_URL`
- `DATABASE_URL_FILE`
- `APP_NAME`
- `LOG_LEVEL`
- `PUBLIC_AUTH_MODE`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_PASSWORD_FILE`
- `JWT_SECRET`
- `JWT_SECRET_FILE`
- `WORKER_TICK_SECONDS`

For production, you should also provide the relevant connector and auth configuration:
- Zabbix, Prometheus, PRTG, or webhook connector settings
- LDAP settings if using LDAP auth
- SAML or OIDC settings if using SSO
- Slack and SMTP settings if using notifications

Sensitive configuration supports Docker-style file-backed secrets. Any supported variable can be provided as either `NAME=value` or `NAME_FILE=/run/secrets/name`. File-backed settings are resolved at startup before validation.

### Observability

The API exposes lightweight operational endpoints:
- `/healthz`: compatibility health check
- `/livez`: liveness probe
- `/readyz`: readiness probe
- `/metrics`: Prometheus-compatible metrics

The metrics endpoint includes:
- process and runtime metrics from `prom-client`
- HTTP request counts
- HTTP request duration histograms

The API log level is controlled with `LOG_LEVEL`.

### Local Development

Install dependencies:

```bash
npm install
```

Run the API, frontend, and worker together:

```bash
npm run dev
```

Useful validation commands:

```bash
npm run typecheck
npm test
npm run build
```

## Contributing

Contributions should preserve the current architecture:
- the UI reads cached status from the API, not live monitoring backends
- monitoring connectors normalize source-specific states into the shared status model
- the worker is responsible for collection, webhook ingestion, and event-driven notifications

Recommended contribution workflow:

1. Create a branch for your change.
2. Make focused changes with tests where relevant.
3. Run:

```bash
npm run typecheck
npm test
npm run build
```

4. Update documentation when behavior, APIs, deployment, or architecture change.
5. Open a merge request with a concise description of the change, risks, and validation performed.

Good contribution areas include:
- connector improvements
- auth provider hardening
- deployment hardening
- UI improvements
- deeper end-to-end and integration coverage
- documentation and operator guidance

## License

This project is licensed under the BSD 3-Clause License. See [LICENSE](LICENSE).

## CI

GitHub Actions validates:
- type checking
- coverage thresholds
- production build
- Docker image build

Coverage artifacts for the API and web application are uploaded from each CI run.
# servicelevels
