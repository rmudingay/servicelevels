# Implementation Plan

This plan turns the remaining work into five execution sessions. Each session should end in a shippable intermediate state with the workspace still building cleanly.

## Status

Session 1 is implemented in code:
- worker process entrypoint exists
- scheduled collection loop exists
- snapshot persistence pipeline exists
- connector health timestamps are updated
- admin collection-health endpoint is available

## Session 1: Worker Backbone And Snapshot Pipeline

Goal: make collection and persistence real, even before all vendors are integrated.

Scope:
- add a dedicated worker process
- add scheduled polling loop
- define the snapshot normalization contract
- persist collected snapshots through the repository layer
- record connector last-success and last-error timestamps
- expose basic collection health in the admin API

Acceptance criteria:
- worker starts independently from the web/api process
- a scheduled job can append a normalized snapshot for at least one tenant
- connector health timestamps update when a collection succeeds or fails
- public status reads continue to use cached snapshots only

Status: complete

Estimated effort: 1 session

## Session 2: Monitoring Connectors

Goal: implement real integrations against the monitoring platforms.

Scope:
- Prometheus connector for both alert-rule and direct-query modes
- Zabbix connector for triggers, host groups, tags, and maintenance
- PRTG connector for sensors, devices, groups, and tags
- inbound webhook status updates
- connector-specific filter configuration and validation

Acceptance criteria:
- each connector can produce a normalized snapshot
- connector filters are configurable per platform
- webhook payloads update the same normalized snapshot path
- failed connector polls do not break unrelated tenants or the public UI

Status: complete

Estimated effort: 1 to 2 sessions

## Session 3: Authentication And Admin Control Plane

Goal: finish the identity and privilege model.

Scope:
- LDAP support
- SAML, OAuth2, and OpenID Connect support
- status-page auth mode enforcement end-to-end
- main-admin-only promotion of additional admins
- admin UI for editing and deleting connectors
- validation for connector config/auth JSON blobs

Acceptance criteria:
- status-page auth mode is enforced consistently
- local and remote admin auth both work as planned
- only the main admin can promote another admin
- connector CRUD is available from the admin UI and server-side validated

Status: complete

Estimated effort: 1 session

## Session 4: Notifications And Public Consumption

Goal: make the app useful for operators and consumers, not just viewers.

Scope:
- RSS feed generation from incidents, banners, and maintenance
- Slack notification delivery
- email notification delivery
- banner precedence cleanup for topic/category/service scoping
- public API hardening and versioning review

Acceptance criteria:
- RSS reflects current incidents and maintenance state
- Slack and email notifications can be triggered by state transitions
- banner scopes resolve predictably
- public API versioning is stable and documented

Estimated effort: 1 session

Status: complete

## Session 5: Hardening And Test Coverage

Goal: stabilize the codebase after the core flows are real.

Scope:
- migrate from auto-create schema to explicit PostgreSQL migrations
- add indexes and constraints for the core tables
- add repository and route integration tests
- add connector normalization tests
- add a small set of UI tests for critical public/admin flows

Acceptance criteria:
- database schema is migration-driven
- core routes and repository behavior are covered by tests
- connector normalization has regression coverage
- the workspace still builds cleanly

Estimated effort: 1 session

Status: complete

Implemented in this session:
- explicit PostgreSQL migration runner
- memory-store daily rollup tests
- Postgres repository integration test using a real SQL-backed adapter path
- connector normalization tests for Prometheus, Zabbix, and PRTG
- UI smoke tests for the public status page and admin login flow
- route-level end-to-end tests for OIDC and SAML callback handling
- route-level webhook ingestion coverage through the worker snapshot path
- notification delivery coverage for Slack and email event fan-out
- full workspace validation with `typecheck`, `test`, and `build`

## Recommended Order

1. Session 1
2. Session 2
3. Session 3
4. Session 4
5. Session 5
