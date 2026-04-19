# Service Levels application

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
- `db`: PostgreSQL 16
- `app`: API and frontend delivery on port `8080`
- `worker`: scheduled collector and notification processor

Start the stack:

```bash
docker compose up --build
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
- `APP_NAME`
- `PUBLIC_AUTH_MODE`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `WORKER_TICK_SECONDS`

For production, you should also provide the relevant connector and auth configuration:
- Zabbix, Prometheus, PRTG, or webhook connector settings
- LDAP settings if using LDAP auth
- SAML or OIDC settings if using SSO
- Slack and SMTP settings if using notifications

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
# servicelevels
