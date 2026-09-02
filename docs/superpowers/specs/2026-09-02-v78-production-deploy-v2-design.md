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
Nginx container :80
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

- V78 application/deployment baseline: `cb9decd1054ca6c9e6931f6fb24627d6ae6f280c`
- Go bridge: `13e40da4092046846ad13c5c0bbb15918216465a`

The AMD64 release branch contains workflow-only commits on top of that baseline. V2 deployment work branches from that verified release line.

## Design Principles

1. GitHub configuration must describe what production actually runs.
2. Only Nginx may bind a public host port.
3. Node `3000`, Go `4000`, MySQL `3306`, and 121 Worker `8787` remain Docker-internal only.
4. Production deployment on this ECS must not require Docker Hub access.
5. Production deployment must never rebuild application images on ECS.
6. Deployment must fail closed before public cutover if required services are unhealthy.
7. Rollback must restore matching application images and deployment configuration.
8. Data volumes and secrets must never be deleted by deploy or rollback scripts.
9. `.env` remains server-only and must never be committed or placed in a GitHub artifact.
10. HTTPS/domain migration is a separate second phase; this design keeps the current `:3000` endpoint working first.

## Public Port Model

Add one required server environment variable:

```text
PUBLIC_PORT=3000
```

Compose binds Nginx with:

```text
${PUBLIC_PORT:?PUBLIC_PORT is required}:80
```

Nginx continues listening on container port 80 and proxying to `v78-node:3000`.

The security boundary remains:

```text
public 3000 → nginx:80 → v78-node:3000 internal
```

`PUBLIC_PORT` is the only host-facing HTTP port setting. Verification, runbook text, and deployment output derive the URL from `PUBLIC_IP` and `PUBLIC_PORT`; no production script may hard-code host port 80.

## Production Mode Guard

Add:

```text
DEPLOY_MODE=offline-production
```

The existing build-oriented `deploy.sh` must refuse to run when `DEPLOY_MODE=offline-production`, with a message directing the operator to `offline-deploy.sh`. This prevents an accidental future `docker pull` or `docker build` on the current ECS.

`offline-deploy.sh` must require `DEPLOY_MODE=offline-production` before it changes running services.

## Offline Deployment Contract

Production ECS deployment uses a release directory supplied to `offline-deploy.sh`.

Expected release files:

```text
qiantie-v78-linux-amd64-base.tar.gz
qiantie-v78-linux-amd64-browser-worker.tar.gz
qiantie-v78-linux-amd64-go.tar.gz
qiantie-v78-linux-amd64-node.tar.gz
SHA256SUMS
RELEASE-METADATA.txt
```

Expected sequence:

```text
GitHub Actions
  ↓
build + smoke linux/amd64
  ↓
immutable archives + metadata + SHA256
  ↓
Mac downloads and verifies artifact
  ↓
SCP exact release files to ECS
  ↓
ECS sha256sum -c
  ↓
docker load only
  ↓
validate required images + amd64
  ↓
snapshot current release
  ↓
start private services with --no-build --pull never
  ↓
health gates
  ↓
start/recreate Nginx
  ↓
post-cutover verification
```

The offline production script must never run:

- `docker pull`
- `docker build`
- `docker compose down -v`
- any volume deletion
- `.env` regeneration

It must use `docker compose ... up -d --no-build --pull never` for production starts.

## Runtime Health Model

The existing MySQL health check remains.

Add a Compose health check to Node using the Node runtime already present in the image:

```text
fetch('http://127.0.0.1:3000/api/build-info')
```

Add a Compose health check to the 121 Browser Worker using the Node runtime already present in that image. It calls `/healthz` with `QIANTIE_121_WORKER_SECRET` and must not print the secret.

Do not add a shell-based Compose health check to the current Go image in this phase. The verified Go runtime image is distroless and contains no shell/curl utility. Go health remains an explicit required pre-cutover request from the Node container to `http://go-api:4000/health`.

Therefore the production health contract is:

- MySQL: Compose `healthy`.
- Node: Compose `healthy` plus explicit `/api/build-info` request.
- 121 Worker: Compose `healthy` plus explicit signed `/healthz` request.
- Go: explicit `/health` request before Nginx cutover.

A container being merely `running` is never sufficient evidence of readiness.

## Verification Contract

`verify.sh` validates the configured production topology and prints a separate result for each layer:

1. Compose model is valid.
2. `PUBLIC_PORT` is present and numeric in the range 1-65535.
3. MySQL container health is `healthy`.
4. Node `/api/build-info` succeeds.
5. Go `/health` succeeds.
6. 121 `/healthz` succeeds with the internal secret.
7. Nginx local entry succeeds at `http://127.0.0.1:${PUBLIC_PORT}/api/build-info`.
8. External URL is printed as `http://${PUBLIC_IP}:${PUBLIC_PORT}` for operator/client-side verification.

`verify.sh` does not claim login or business acceptance.

## Release Source Integrity

The release workflow must distinguish application baseline from deployment-definition commit.

Metadata records:

```text
V78_BASE_SHA=cb9decd1054ca6c9e6931f6fb24627d6ae6f280c
DEPLOY_SHA=<exact commit containing the V2 deployment files used by the workflow>
GO_SHA=13e40da4092046846ad13c5c0bbb15918216465a
architecture=linux/amd64
workflow_run_id=<GitHub Actions run id>
```

During this V2 work, the workflow builds from the exact V2 branch commit but must fail if the diff from `V78_BASE_SHA` includes application/runtime code outside this allowlist:

```text
.github/workflows/v78-amd64-image-release.yml
deploy/v78-public/**
docs/superpowers/**
```

This permits deployment-definition changes while proving the V78 application source itself is still the locked baseline.

The Go checkout remains pinned to the exact verified Go SHA.

## Release Manifest

Every AMD64 release artifact contains `RELEASE-METADATA.txt` and `SHA256SUMS` with at least:

- architecture `linux/amd64`
- V78 base SHA
- deployment-definition SHA
- Go SHA
- workflow run ID
- exact image names/tags
- OS/architecture for each image
- SHA256 for every image archive
- `smoke=passed`

No secrets are stored in the release metadata.

The ECS keeps the metadata for each imported release under:

```text
/opt/qiantie/releases/<release-id>/
```

## Release Snapshot

Create exactly one helper:

```text
deploy/v78-public/release-snapshot.sh
```

Before public cutover it creates:

```text
/opt/qiantie/releases/<snapshot-id>/previous/
```

containing:

- `docker-compose.yml`
- `nginx.conf`
- non-secret release metadata if present
- `image-ids.txt` for the three application images

It must not copy `.env` into Git-controlled locations or print secret contents.

## Rollback Model

`rollback.sh` becomes release-snapshot based.

It restores the previous snapshot's Compose and Nginx files, restores the recorded application image references, then starts with `--no-build --pull never` and runs `verify.sh`.

Rollback never:

- removes MySQL volumes
- removes browser sessions
- removes V78 data/output volumes
- regenerates `.env`
- attempts a destructive database schema downgrade

Automatic rollback is application/config rollback only. It does not reverse MySQL migrations. The runbook must state this explicitly. Any future release with a schema change must be reviewed for backward compatibility before cutover.

## Backup Model

Create:

```text
deploy/v78-public/backup.sh
```

It writes a timestamped backup under:

```text
/opt/qiantie/backups/<timestamp>/
```

using only already-running production containers; it must not pull a utility image.

The backup contains:

- MySQL logical dump produced inside the MySQL container.
- tar archive of `/app/data` streamed from `v78-node`.
- tar archive of `/app/outputs` streamed from `v78-node`.
- tar archive of `/data/sessions` streamed from `browser-worker`.
- a server-local `.env` safety copy with mode `0600`.
- `SHA256SUMS` for the backup files.

The backup process never prints secret values and never stops or deletes the production volumes.

A local backup protects against accidental edits/deletes but not total ECS loss. The runbook must instruct the operator to copy completed backup sets and the protected `.env` copy off-server. Automated third-party backup upload is out of scope for this phase.

## Secrets

The following values remain server-only and stable across normal releases:

- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `QIANTIE_BRIDGE_SECRET`
- `QIANTIE_121_WORKER_SECRET`
- `QIANTIE_121_CREDENTIAL_SECRET`

`QIANTIE_121_CREDENTIAL_SECRET` must remain stable because changing or losing it may make persisted 121 credentials unreadable.

No release artifact, GitHub commit, Actions log, release metadata, or ordinary verification output may contain real secret values.

## Business Acceptance Gate

Infrastructure verification is followed by this production acceptance sequence:

1. Open the login page from an external client.
2. Perform normal login.
3. Open Novel Fetch.
4. Create one dedicated acceptance test task.
5. Refresh and confirm the task remains.
6. Perform the real 121 login/verification path.
7. Restart `go-api`, `browser-worker`, and `v78-node` without deleting volumes.
8. Re-open Novel Fetch and confirm the test task remains.
9. Confirm saved 121 state behaves as expected after restart.

Only after these checks pass may the release be described as fully production-accepted.

## HTTPS Phase Boundary

V2 deliberately keeps:

```text
http://115.190.156.223:3000
```

working while deployment reliability is fixed.

A later separate phase introduces:

```text
https://<domain>
```

on 443, with DNS, TLS certificates, HTTP-to-HTTPS redirect, secure-cookie review, and Passkey/WebAuthn validation. Raw-IP HTTP is not the final long-term authentication posture.

## Files Expected To Change During Implementation

- `deploy/v78-public/.env.example`
- `deploy/v78-public/docker-compose.yml`
- `deploy/v78-public/deploy.sh`
- `deploy/v78-public/verify.sh`
- `deploy/v78-public/CODEX_RUNBOOK.md`
- create `deploy/v78-public/offline-deploy.sh`
- create `deploy/v78-public/release-snapshot.sh`
- modify `deploy/v78-public/rollback.sh`
- create `deploy/v78-public/backup.sh`
- modify `.github/workflows/v78-amd64-image-release.yml`
- add focused deployment tests/checks for port configuration, offline guards, release metadata, backup behavior, and secret exclusion

No application feature behavior is changed in V2.

## Success Criteria

V2 is implementation-complete only when all of the following have fresh verification evidence:

1. GitHub Compose and ECS use the same required `PUBLIC_PORT`, currently `3000`.
2. Nginx is the only public host-port binding.
3. ECS production deployment completes with `--no-build --pull never` and no registry access.
4. Build-oriented `deploy.sh` refuses to run in `offline-production` mode.
5. MySQL, Node, Go, and 121 health gates all pass before Nginx cutover.
6. `verify.sh` uses `PUBLIC_PORT` and contains no hard-coded host-port 80 assumption.
7. AMD64 release metadata proves V78 base SHA, deployment SHA, Go SHA, workflow run, image names, architecture, archive checksums, and smoke result.
8. Rollback restores matching deployment configuration and application image references without deleting data.
9. `backup.sh` produces a checksummed backup set without deleting or stopping production data.
10. Real secrets do not enter Git or GitHub artifacts.
11. Existing `http://115.190.156.223:3000` remains the supported public endpoint until the separate HTTPS phase is approved.
