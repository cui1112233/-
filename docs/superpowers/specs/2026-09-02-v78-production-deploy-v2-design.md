# V78 Production Deploy V2 Design

## Status

Approved direction from the 2026-09-02 deployment review. This design standardizes the GitHub deployment definition with the currently running ECS topology before any further V78 feature rollout.

## Goal

Make V78 production deployment repeatable, offline-capable, verifiable, rollback-safe, and consistent between GitHub and ECS, without disrupting the currently working public entry at `http://115.190.156.223:3000`.

## Current Production Reality

The currently working ECS entry is:

```text
Internet
  ↓
115.190.156.223:3000
  ↓
Nginx public container port
  ↓
v78-node:3000 on Docker internal network
  ↓
Go API / MySQL / 121 Browser Worker
```

The GitHub deployment definition still assumes public port 80, while the ECS instance has been changed to public port 3000. That configuration drift is the first problem to eliminate.

The existing GitHub release pipeline already produces and smoke-tests `linux/amd64` images for:

- `mysql:8.4`
- `nginx:1.27-alpine`
- `qiantie-v78-node:public-v78`
- `qiantie-go-api:public-v78`
- `qiantie-121-browser-worker:public-v78`

The verified runtime sources remain locked to:

- V78 deployment baseline: `cb9decd1054ca6c9e6931f6fb24627d6ae6f280c`
- Go bridge: `13e40da4092046846ad13c5c0bbb15918216465a`

The AMD64 release branch adds workflow-only commits on top of that baseline and is the source branch for this design work.

## Design Principles

1. GitHub configuration must describe what production actually runs.
2. Only Nginx may bind a public host port.
3. Node `3000`, Go `4000`, MySQL `3306`, and 121 Worker `8787` remain Docker-internal only.
4. Production deployment on this ECS must not require Docker Hub access.
5. Production deployment must never rebuild application images on ECS.
6. Deployment must fail closed before public cutover if required services are unhealthy.
7. Rollback must restore both application images and the deployment configuration that belongs to that release.
8. Data volumes and secrets must never be deleted by deploy or rollback scripts.
9. `.env` remains server-only and must never be committed.
10. HTTPS/domain migration is a separate second phase; this design keeps the current `:3000` endpoint working first.

## Public Port Model

Add a single environment variable:

```text
PUBLIC_PORT=3000
```

The Compose Nginx service uses:

```text
${PUBLIC_PORT}:80
```

Nginx continues listening on container port 80 and proxying to `v78-node:3000`.

This keeps the important security boundary:

```text
public 3000 → nginx:80 → v78-node:3000 internal
```

`PUBLIC_PORT` is the only place that controls the host-facing HTTP port. Verification and runbook text must derive the external URL from the same variable instead of hard-coding 80.

## Offline Deployment Flow

Production ECS deployment becomes a separate offline path rather than reusing the current build/pull script.

Expected sequence:

```text
GitHub Actions
  ↓
build + smoke linux/amd64
  ↓
artifact with immutable image archives + manifest + SHA256
  ↓
Mac downloads and verifies artifact
  ↓
SCP exact archives to ECS
  ↓
ECS verifies SHA256
  ↓
docker load only
  ↓
private services start with --no-build --pull never
  ↓
health gates
  ↓
Nginx cutover
  ↓
post-cutover verification
```

The offline production script must not run:

- `docker pull`
- `docker build`
- `docker compose down -v`
- volume deletion
- `.env` regeneration

The existing build-oriented `deploy.sh` may remain for environments that intentionally have registry access, but the production runbook must clearly identify the offline script as the only supported ECS path.

## Runtime Health Model

Add Compose health checks for application services where practical:

- MySQL: retain existing `mysqladmin ping` health check.
- Node: check `http://127.0.0.1:3000/api/build-info` from inside the container.
- Go: check `http://127.0.0.1:4000/health` from inside the Go container, using a tool guaranteed to exist in that image or a process-level equivalent approved by tests.
- 121 Browser Worker: check `/healthz` with `QIANTIE_121_WORKER_SECRET`; the health command must not print the secret.

Compose service startup should use health-based dependency gates where supported, while the deployment verifier must still perform explicit end-to-end checks.

A container being `running` is not considered sufficient evidence of service health.

## Verification Contract

`verify.sh` must validate the currently configured `PUBLIC_PORT` and produce clear failures for each layer:

1. Compose model is valid.
2. MySQL is healthy.
3. Node `/api/build-info` succeeds.
4. Go `/health` succeeds.
5. 121 `/healthz` succeeds with internal secret.
6. Nginx local entry succeeds at `http://127.0.0.1:${PUBLIC_PORT}/api/build-info`.
7. External URL is printed as `http://${PUBLIC_IP}:${PUBLIC_PORT}`.

Verification must not claim business acceptance. Login, Novel Fetch task persistence, and real 121 login remain explicit production acceptance checks after infrastructure verification.

## Release Manifest

Every AMD64 release artifact must include a machine-readable or plain-text release manifest containing at least:

- architecture: `linux/amd64`
- V78 deployment/source SHA
- Go SHA
- workflow run ID
- exact runtime image names/tags
- SHA256 of every archive
- generation timestamp

Production deployment records the manifest locally under a release directory such as:

```text
/opt/qiantie/releases/<release-id>/
```

No secrets are stored in the manifest.

## Rollback Model

Rollback must be release-based, not only image-tag-based.

Before cutover, create a release snapshot containing:

- current Compose file
- current Nginx config
- current non-secret release metadata
- current application image IDs/tags

Rollback restores the prior release's deployment files and application image references, then starts services with `--no-build --pull never` and runs the same verifier.

Rollback must never:

- remove MySQL volumes
- delete browser sessions
- delete V78 data/output volumes
- regenerate `.env`
- downgrade database schema destructively

If a new release contains an irreversible database migration, the release must be marked as not safely rollbackable before cutover. The deploy script must refuse to describe such a release as one-command rollback safe.

## Backup Model

Docker volumes are persistence, not backup.

Add a production backup script that creates a dated backup set containing:

- logical MySQL dump
- `v78_data`
- `v78_outputs`
- `browser_sessions`
- encrypted copy of the server `.env` or an explicit operator-managed secure copy outside Git; the backup process must never print secret values

The backup script must be non-destructive and write to a dedicated backup directory outside active Docker volumes.

The design does not automatically upload backups to a third-party cloud in this phase. Off-server replication can be added after the local backup format is proven.

## Secrets

The following values remain server-only and stable across normal releases:

- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `QIANTIE_BRIDGE_SECRET`
- `QIANTIE_121_WORKER_SECRET`
- `QIANTIE_121_CREDENTIAL_SECRET`

`QIANTIE_121_CREDENTIAL_SECRET` is especially important because changing or losing it may make persisted 121 credentials unreadable.

No release artifact, GitHub commit, log message, or generated manifest may contain real secret values.

## Business Acceptance Gate

Infrastructure verification is followed by a manual production acceptance sequence:

1. Open login page from an external client.
2. Perform normal login.
3. Open Novel Fetch.
4. Create a dedicated test task.
5. Refresh and confirm the task remains.
6. Perform a real 121 login/verification path.
7. Restart application containers without deleting volumes.
8. Re-open Novel Fetch and confirm the test task remains.
9. Confirm saved 121 state behaves as expected after restart.

Only after these steps pass may the release be described as fully production-accepted.

## HTTPS Phase Boundary

This V2 phase deliberately keeps:

```text
http://115.190.156.223:3000
```

working while deployment reliability is fixed.

A later, separate phase will introduce:

```text
https://<domain>
```

on 443, with domain DNS, TLS certificates, HTTP-to-HTTPS redirect, secure-cookie review, and Passkey/WebAuthn validation. Raw-IP HTTP must not be treated as the final long-term authentication posture.

## Files Expected To Change During Implementation

- `deploy/v78-public/.env.example`
- `deploy/v78-public/docker-compose.yml`
- `deploy/v78-public/verify.sh`
- `deploy/v78-public/CODEX_RUNBOOK.md`
- new `deploy/v78-public/offline-deploy.sh`
- new `deploy/v78-public/release-snapshot.sh` or equivalent focused release helper
- `deploy/v78-public/rollback.sh`
- new `deploy/v78-public/backup.sh`
- `.github/workflows/v78-amd64-image-release.yml`
- tests/smoke checks needed to verify port configurability, offline behavior, manifest integrity, and secret exclusion

Implementation should avoid unrelated application refactoring.

## Success Criteria

This design is complete when all of the following are true:

1. GitHub Compose and ECS use the same configurable public port model, with production currently set to 3000.
2. Public exposure is Nginx only.
3. ECS production deploy can complete without Docker Hub access or local builds.
4. Node, Go, MySQL, and 121 health are verified before public cutover.
5. `verify.sh` uses the configured public port and no longer hard-codes port 80.
6. A release manifest proves exactly what was built and loaded.
7. Rollback restores matching deployment configuration and application images without deleting data.
8. Backups can be created without stopping or deleting production data.
9. No real secrets enter Git or release artifacts.
10. Existing `http://115.190.156.223:3000` remains the supported public endpoint until the separate HTTPS phase is approved.
