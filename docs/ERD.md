# Intelli database ERD (entity-relationship diagram)

This is the shape of the whole Intelli database, generated from `db/schema.sql`
(the auto-generated snapshot of the live database). It shows every table, its
columns, and the foreign-key links between them.

How to view it:
- On GitHub, this diagram renders automatically.
- In VS Code, open this file and use the Markdown preview (the Mermaid diagram
  renders inline; install a Mermaid preview extension if it does not).
- To share with the Atlanta team, send them this file, or paste the diagram block
  into any Mermaid viewer (for example mermaid.live). No database login needed.

Last regenerated: 2026-06-18, after Phase 5-BE-a (the `idempotency_key` columns).

```mermaid
erDiagram
    tenants ||--o{ users : "has"
    tenants ||--o{ org_level_definitions : "defines levels"
    tenants ||--o{ nodes : "owns tree"
    tenants ||--o{ assignments : "scopes"
    tenants ||--o{ skus : "owns catalog"
    tenants ||--o{ surveys : "owns"
    tenants ||--o{ survey_assignments : "scopes"
    tenants ||--o{ responses : "owns"
    tenants ||--o{ response_items : "owns"
    tenants ||--o{ pay_periods : "owns"
    tenants ||--o{ time_entries : "owns"
    tenants ||--o{ audit : "owns log"

    nodes ||--o{ nodes : "parent of"
    users ||--o{ assignments : "pinned by"
    nodes ||--o{ assignments : "pin target"

    surveys ||--o{ survey_versions : "has versions"
    survey_versions ||--o{ survey_assignments : "assigned as"
    nodes ||--o{ survey_assignments : "targets"
    users ||--o{ survey_assignments : "created by"

    survey_versions ||--o{ responses : "answered as"
    nodes ||--o{ responses : "at store"
    users ||--o{ responses : "submitted by"

    responses ||--o{ response_items : "explodes into"
    skus ||--o{ response_items : "about product"
    nodes ||--o{ response_items : "at store"
    survey_versions ||--o{ response_items : "for version"

    pay_periods ||--o{ time_entries : "contains"
    users ||--o{ time_entries : "logged by"
    users ||--o{ audit : "acted"

    tenants {
        uuid id PK
        text name
        text code UK
        boolean payroll_enabled
        timestamptz created_at
    }

    users {
        uuid id PK
        uuid tenant_id FK
        text email
        text name
        text role "admin, manager, rep"
        text password_hash
        timestamptz created_at
    }

    org_level_definitions {
        uuid id PK
        uuid tenant_id FK
        int level_order
        text name
        boolean locked
    }

    nodes {
        uuid id PK
        uuid tenant_id FK
        uuid parent_id FK "self, the org tree"
        int level_order
        text name
        text code
        text path "materialized path, scoping"
        text chain "store attribute, e.g. CVS"
        text address
        float lat
        float lng
        text tz
        timestamptz created_at
    }

    assignments {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        uuid node_id FK
        timestamptz created_at
    }

    skus {
        uuid id PK
        uuid tenant_id FK
        text line
        text variant
        text upc
        text color
        text status "active, discontinued"
        jsonb reference_images
        timestamptz created_at
    }

    surveys {
        uuid id PK
        uuid tenant_id FK
        text name
        text type
        text status "draft, published, archived"
        timestamptz created_at
    }

    survey_versions {
        uuid id PK
        uuid survey_id FK
        int version_number
        jsonb questions
        timestamptz published_at "freeze marker"
        timestamptz created_at
    }

    survey_assignments {
        uuid id PK
        uuid tenant_id FK
        uuid survey_version_id FK
        uuid target_node_id FK
        uuid created_by FK
        timestamptz deadline
        text timezone_basis
        timestamptz created_at
    }

    responses {
        uuid id PK
        uuid tenant_id FK
        uuid survey_version_id FK
        uuid store_node_id FK
        text store_path "snapshot at submit"
        uuid user_id FK
        boolean online
        timestamptz submitted_at
        timestamptz created_at
        uuid idempotency_key "claim ticket, Phase 5-BE-a"
    }

    response_items {
        uuid id PK
        uuid response_id FK
        uuid tenant_id FK
        uuid store_node_id FK
        text store_path
        uuid survey_version_id FK
        timestamptz submitted_at
        text question_id "matches questions json, not an FK"
        uuid sku_id FK "null for non-per-product answers"
        jsonb value
    }

    pay_periods {
        uuid id PK
        uuid tenant_id FK
        text name
        date start_date
        date end_date
        timestamptz cutoff_at
        text timezone_basis
        int grace_hours
        text lock_behavior
        text status "open, sealed"
        timestamptz sealed_at
        timestamptz created_at
    }

    time_entries {
        uuid id PK
        uuid tenant_id FK
        uuid period_id FK
        uuid user_id FK
        int store_min
        int reset_min
        int drive_min
        numeric miles
        text mgr_status "pending, approved, rejected"
        boolean sealed
        timestamptz created_at
        uuid idempotency_key "claim ticket, Phase 5-BE-a"
    }

    audit {
        uuid id PK
        uuid tenant_id FK
        uuid actor_user_id FK
        text action
        text target
        jsonb detail
        timestamptz at
    }
```

## How to read it (plain terms)

- **`tenants` is the root of everything.** Every company's data carries a
  `tenant_id`, so almost every table links back to `tenants`. That hub is the
  multi-tenant design: one company never sees another's rows.
- **`nodes` points at itself** (`parent_id`). That is the org tree: a region
  contains districts, a district contains stores, and so on, to any depth.
- **`users` are pinned by `assignments`** to one `node`. That pin, plus the
  `nodes.path` column, is the "scope follows the pin" security boundary (a manager
  sees only their branch).
- **Surveys freeze into versions.** A `survey` has `survey_versions`; once a
  version is published it never changes; results (`responses`) always point at the
  exact version they were answered under.
- **A `response` explodes into `response_items`.** One survey submission becomes
  many atomic rows, one per product per question. That is what powers the per-SKU
  analytics. Pass/fail is computed live from the version's rules and is never
  stored.
- **Payroll:** a `pay_period` contains `time_entries` (one per rep per period),
  and `audit` is the permanent logbook of sensitive actions.

## Two relationships that are NOT drawn as connector lines (by design)

- **The org-tree scoping** uses the `nodes.path` text column (a materialized path
  like `/region/district/store/`), not a foreign key, so it is fast to query
  "everything under X". The diagram shows the `parent_id` self-link; the path is
  the same tree expressed for speed.
- **`response_items.question_id` is text**, matching an id inside the version's
  `questions` JSON, not a foreign key to a questions table (questions live as JSON
  on the version). So there is no connector line for it.

One more table exists that is not shown: `schema_migrations`, which is internal
bookkeeping for the migration tool (dbmate), not part of the data model.

## Keeping this current

This diagram is generated by hand from `db/schema.sql`. Whenever a migration
changes the database shape, regenerate `db/schema.sql` (it happens automatically
on `docker compose run --rm migrate up`) and update this diagram to match. A
database viewer like DBeaver can also auto-draw this same picture from a live
connection (see DEPLOY.md section 4 for how Atlanta connects).
