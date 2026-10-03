# V88 Unified Runtime Configuration Design

## Goal

Make `deploy/v88-public/docker-compose.yml` the only production Compose
topology for the active V88 application and its 121 browser worker.

## Decision

`browser-worker` remains the sole production 121 worker. The historical
`novel-fetch-121-worker` override is retired because the active Node service
already uses `http://browser-worker:8787`. Browser sessions stay in their
existing external volumes and are never copied or deleted by this change.

## Boundaries

- The MySQL container, application volumes, compatibility service and Nginx
  routing remain unchanged.
- Direct-mount and external merge fragments are not activated or removed here:
  they are separate release modes and need their own provider/configuration
  acceptance before migration.
- The legacy orphan worker is stopped only after the retained worker passes its
  authenticated health probe and the Node runtime still points at it.

## Runtime changes

The main Compose file gains the browser worker healthcheck already used by the
old override. `v88-node` waits for that healthcheck and receives the explicit
121 client timeout from the same `.env` schema. The obsolete browser-worker
override file is removed.

## Acceptance

1. `docker compose --env-file .env.example config -q` succeeds.
2. The rendered topology has exactly one 121 worker service named
   `browser-worker` and Node points to it over Docker DNS.
3. On ECS, the worker health endpoint returns 200 with the internal secret,
   Node retains the `browser-worker` URL, and only then is the orphan container
   removed without deleting either session volume.
