# API Surface

## Principles

- Public APIs are read-only.
- Admin APIs require authentication.
- Developer APIs are versioned.
- The browser reads from the current cached snapshot and daily rollups only.

## Public API

Suggested endpoints:
- `GET /api/v1/status`
- `GET /api/v1/tenants`
- `GET /api/v1/tenants/:tenantId/tabs`
- `GET /api/v1/tenants/:tenantId/services`
- `GET /api/v1/tenants/:tenantId/banners`
- `GET /api/v1/tenants/:tenantId/incidents`
- `GET /api/v1/tenants/:tenantId/maintenance`
- `GET /api/v1/tenants/:tenantId/branding`
- `GET /api/v1/rss`

## Admin API

Suggested endpoints:
- `GET /api/v1/admin/me`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `PATCH /api/v1/admin/users/:userId`
- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants`
- `GET /api/v1/admin/connectors`
- `POST /api/v1/admin/connectors`
- `GET /api/v1/admin/tabs`
- `POST /api/v1/admin/tabs`
- `GET /api/v1/admin/banners`
- `POST /api/v1/admin/banners`
- `GET /api/v1/admin/incidents`
- `GET /api/v1/admin/maintenance`
- `GET /api/v1/admin/subscriptions`
- `POST /api/v1/admin/subscriptions`
- `DELETE /api/v1/admin/subscriptions/:id`
- `GET /api/v1/admin/colors`
- `POST /api/v1/admin/colors`
- `GET /api/v1/admin/branding`
- `PATCH /api/v1/admin/branding`
- `GET /api/v1/admin/schedules`

## Developer API

Suggested patterns:
- `/api/v1/dev/...` for contribution and automation endpoints
- strict request/response schemas
- clear versioning and deprecation policy

## Inbound Webhooks

Suggested endpoint:
- `POST /api/v1/webhooks/:tenantId/:source`

Webhook payloads should be normalized and persisted before they affect public status views.

The public status response also exposes daily rollups for tenant-level historical summaries.
