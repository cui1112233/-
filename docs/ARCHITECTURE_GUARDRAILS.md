# Architecture Guardrails

This document defines the migration direction for the `refactor/react-go-production` branch. The goal is to reduce architecture drift while preserving the current working product.

## Target architecture

- Frontend: React + Ant Design + Vite
- Backend/API: Go + chi
- Primary database: MySQL
- Queue / distributed locks / short-lived cache: Redis
- Object storage: TOS (with local storage allowed for development/fallback through the existing storage abstraction)
- Deployment: Docker Compose
- Production application serving: Go serves the built React frontend and API from one application entry point where practical

## Ownership rules

| Domain | Current owner | Target owner | Rule during migration |
| --- | --- | --- | --- |
| Frontend UI | React + legacy HTML/JS | React | New UI work goes to React only. Legacy UI is maintenance-only. |
| API edge | Express + Go | Go | Do not add new core business APIs to Express. |
| Authentication | Express and Go both exist | Go | Keep Express auth active until Go password hashing/token expiry are hardened. |
| Generation history | Express file store + Go/MySQL | Go/MySQL | Migrate to one source of truth before removing legacy writes. |
| Shuihuo production | Go | Go | Keep in Go. |
| Documents/articles | Not unified | Go/MySQL | New document features must be implemented in Go/MySQL, not JSON/txt files. |
| Novel panel | Legacy Node implementation | Go/React later | Freeze legacy implementation except bug fixes until a planned migration. |
| Object/media files | Local disk abstraction | TOS | Keep storage behind the existing object-storage interface. |
| Queue/locks | Not unified | Redis | Use Redis only for queues, locks and short-lived cache; MySQL remains the durable source of truth. |
| Prompts | Mixed | Go/MySQL | Core hidden prompts stay server-side; editable/admin prompts may live in MySQL with versions. |

## Non-negotiable rules

1. Do not replace `chi` with Gin just for framework preference. The current Go API is already built on chi.
2. Do not create a second React application or a new frontend stack.
3. Do not add new JSON/txt stores for durable business data.
4. Do not store user documents only in browser storage. Browser storage is draft/recovery cache only.
5. Do not delete Express/legacy UI in one large rewrite. Migrate domain by domain and remove only after the replacement is verified.
6. Do not use Redis as the primary database.
7. Do not put large media files into MySQL; store metadata in MySQL and file objects in TOS/object storage.
8. Do not commit runtime user data, sessions, logs, API keys, generated outputs, or local object-storage contents to Git.
9. Do not enable insecure development defaults in production. Production startup should eventually fail fast when default secrets/passwords are detected.
10. Every migration should have a rollback path and should be made in small commits on this refactor branch.

## Migration order

1. Protect runtime data and define architecture ownership.
2. Harden Go authentication and production configuration.
3. Migrate generation history to Go/MySQL as a single source of truth.
4. Implement new Documents/Articles features directly in Go/MySQL.
5. Move remaining API domains from Express to Go one by one.
6. Retire legacy frontend fallbacks after React feature parity.
7. Build production Docker image using Node only in the build stage, then run the Go binary in production.
8. Integrate Redis where queue/lock requirements actually exist.
9. Enable TOS for production media/object storage.

## Runtime vs source data

Runtime data must stay outside source control. Examples include sessions, user outputs, generated media, error logs, mutable account stores and per-user project data.

Seed/config data may remain in source control only when it is intentionally immutable and safe to publish inside the repository. Mutable runtime copies should be separated from seed files instead of sharing the same path.

## Change policy for this branch

Before making a structural change, answer these questions:

- What user/business problem does this solve?
- Is there already an implementation that can be extended safely?
- Does this create a second source of truth?
- Can this change lose user data or invalidate sessions?
- What is the rollback path?
- Can it be split into a smaller change?

If a proposed command conflicts with these guardrails, challenge the command and solve the underlying requirement instead.
