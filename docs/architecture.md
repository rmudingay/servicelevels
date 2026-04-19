# Architecture Overview

## Goals

Provide a public status page that:
- shows normalized status for multiple tenants
- supports configurable tabs and banners
- avoids live querying external monitoring systems from the UI
- can be deployed in Docker containers
- supports theming, branding, and configurable color mappings

## High-Level Layout

```mermaid
flowchart LR
  subgraph Browser
    UI[React Public UI]
    ADM[React Admin UI]
  end

  subgraph App[Node.js Application]
    API[HTTP API]
    AUTH[Auth Layer]
    NORM[Status Normalizer]
    NOTIFY[Notification Engine]
    WORKER[Polling / Webhook Worker]
  end

  subgraph External[External Systems]
    PRTG[PRTG]
    ZBX[Zabbix]
    PRM[Prometheus]
    WH[Inbound Webhooks]
    LDAP[LDAP / IdP]
    SLACK[Slack]
    SMTP[Email]
    RSS[RSS Readers]
  end

  subgraph Data[Persistence]
    DB[(PostgreSQL)]
    CFG[Bootstrap ini]
  end

  UI --> API
  ADM --> API
  API --> AUTH
  API --> DB
  WORKER --> PRTG
  WORKER --> ZBX
  WORKER --> PRM
  WORKER --> WH
  WORKER --> NORM
  NORM --> DB
  NOTIFY --> SLACK
  NOTIFY --> SMTP
  API --> RSS
  AUTH --> LDAP
  API --> CFG
```

## Runtime Services

### Web/API Service
- Serves the public and admin React applications.
- Exposes read and write APIs.
- Handles authentication, sessions, and authorization.
- Serves the latest cached status snapshot, daily rollups, and configuration.

### Worker Service
- Polls external monitoring systems on a schedule.
- Processes inbound webhooks.
- Normalizes source data into the internal status model.
- Persists the latest snapshot per tenant, daily rollups, incidents, banners, and maintenance transitions.
- Triggers RSS, Slack, and email notifications.

### Database
- Stores runtime configuration, current status cache, and daily history rollups.
- Supports tenant separation and auditability.

## Design Constraints

- The UI must never be the component that contacts monitoring backends.
- Polling intervals must be configurable and default to 5 minutes.
- The system must degrade gracefully if one external connector fails.
- Status color mapping must be configurable by admin.
- Application name and logo must be configurable.

## Tenant Strategy

Each tenant is a logical location or domain. A tenant owns:
- tabs
- services
- banners
- branding
- connector definitions
- notification settings
- color mapping overrides

Tenant isolation is logical first. Physical isolation is not required for the initial design.
