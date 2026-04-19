# Data Model

## Core Entities

### tenant
Represents one logical location or domain.

Fields:
- `id`
- `name`
- `slug`
- `description`
- `enabled`
- `created_at`
- `updated_at`

### service
Represents a monitored item shown in the UI.

Fields:
- `id`
- `tenant_id`
- `name`
- `slug`
- `category`
- `topic`
- `tags`
- `source_type`
- `source_ref`
- `enabled`
- `created_at`
- `updated_at`

### tab
Represents a configurable view in the public UI.

Fields:
- `id`
- `tenant_id`
- `title`
- `slug`
- `sort_order`
- `filter_definition`
- `is_global`
- `enabled`

### banner
Represents contextual text shown on the status page.

Fields:
- `id`
- `tenant_id`
- `scope_type`
- `scope_ref`
- `title`
- `message`
- `severity`
- `starts_at`
- `ends_at`
- `active`
- `created_by`

### connector
Represents a monitoring source configuration.

Fields:
- `id`
- `tenant_id`
- `type`
- `name`
- `config_json`
- `auth_json`
- `enabled`
- `poll_interval_seconds`
- `last_success_at`
- `last_error_at`

### status_snapshot
Represents the latest collected status view for a tenant.

Fields:
- `id`
- `tenant_id`
- `collected_at`
- `overall_status`
- `services`
- `raw_payload`

### status_daily_summary
Represents the daily rollup for a tenant.

Fields:
- `tenant_id`
- `day`
- `overall_status`
- `seconds_by_status`
- `first_collected_at`
- `last_collected_at`
- `sample_count`

### incident
Represents an ongoing or historical outage/degradation.

Fields:
- `id`
- `tenant_id`
- `service_id`
- `title`
- `description`
- `status`
- `opened_at`
- `resolved_at`
- `source_type`

### maintenance_window
Represents scheduled maintenance.

Fields:
- `id`
- `tenant_id`
- `service_id`
- `title`
- `description`
- `starts_at`
- `ends_at`
- `status`
- `created_by`

### user
Represents an authenticated person.

Fields:
- `id`
- `username`
- `display_name`
- `email`
- `auth_type`
- `enabled`
- `created_at`
- `updated_at`

### role
Represents authorization scope.

Fields:
- `id`
- `name`
- `description`
- `is_admin`

### user_role
Maps users to roles.

Fields:
- `user_id`
- `role_id`

### subscription
Represents a notification subscription.

Fields:
- `id`
- `tenant_id`
- `service_id`
- `channel_type`
- `target`
- `enabled`

### branding
Represents configurable presentation metadata.

Fields:
- `tenant_id`
- `app_name`
- `logo_url`
- `favicon_url`
- `theme_default`

### color_mapping
Represents admin-defined status colors.

Fields:
- `tenant_id`
- `status_key`
- `color_hex`
- `label`

## Configuration Storage Split

Store in `ini`:
- bootstrap admin credentials
- database connection bootstrap
- base URL
- deployment flags

Store in PostgreSQL:
- everything editable at runtime
- users and roles
- tenants and services
- connector definitions
- banners
- tabs
- incidents
- maintenance
- subscriptions
- branding
- color mappings
- snapshots
- daily summaries

## Relationship Summary

- One tenant has many tabs, services, banners, connectors, daily summaries, incidents, and maintenance windows.
- One tenant has at most one current snapshot row.
- One service can appear in multiple tabs through filters.
- One user can have multiple roles.
- One tenant can override branding and color mappings.
