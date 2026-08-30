# Production V78.3.0.3 Snapshot

## Provenance

- Production version: `V78.3.0.3`
- Production build ID: `v78.3.0.3-remote-workbench-20260819-r1`
- Source image reference: `qiantie-platform:production`
- Source image ID and local digest: `sha256:91f9741a9291d9e0e1ba64cc8c317a99b078cd440d6c3fc94136a1f6bc7e55fd`
- Image creation time: `2026-08-28T01:34:53.607080958Z`
- Snapshot extraction time (UTC): `2026-08-30T05:44:23Z`
- Platform: `linux/arm64`
- Image labels: `com.docker.compose.project=qiantie-production`, `com.docker.compose.service=platform`, `com.docker.compose.version=5.3.1`
- Image Git revision metadata: unavailable. `docker image inspect` contains no source commit, tag, or CI build URL.

## Git Baseline Search

No exact Git baseline was found. The repository has no V78.3.0.3 tag or release branch. The production container records the historical deployment worktree path, but its current tree is dirty and its `app.js` hash does not match the production image. The production image's `app.js` hash also does not match any reachable Git revision in the local repository.

This branch is intentionally parentless. It is a content snapshot of the production image, not a claim that the image was built from a known Git commit.

## Extracted Content

Copied read-only from `/app` in the stopped extraction container created from the source image:

- `app.js`, `server.js`, `index.html`
- `package.json`, `package-lock.json`
- `lib/`, `middleware/`, `routes/`
- `pets/`, `prompts/`, `public/`
- `frontend/dist/` including the production-rendered Vite assets and batch-rewrite static files

`Dockerfile` is a reconstruction recipe. It uses Node `24.19.0-alpine`, installs runtime dependencies from the extracted lockfile, and copies the extracted runtime source plus the original compiled frontend assets.

## Explicit Exclusions

Not copied from the image or any container/volume:

- `node_modules/` (recreated by `npm ci --omit=dev` from the extracted lockfile)
- Docker volumes, including all `/app/data` runtime user/system data
- `outputs/`, database contents, Redis contents, object storage, Docker environment variables, secrets, tokens, credentials, and production Compose environment files
- Frontend source, frontend package metadata, frontend lockfile, and frontend build configuration: unavailable in the production image
- Tests and source Docker build records: unavailable in the production image

## Key SHA-256 Values

| Path | SHA-256 |
| --- | --- |
| `app.js` | `a3843106af770a6b7e527d29b2d09b1eaa7f3adf51ba52f63121d862a02cd06c` |
| `package.json` | `8c2c69ac53fcf89e0b20619bd4cde5850c079636d80b3a6f7de1cc42e20d2477` |
| `package-lock.json` | `e7db656cd8a74fc3645b4220531c0edd3808d6a27c6177c66db5c41085f02728` |
| `lib/preset-store.js` | `5f44a626f20fd266c485b0d3d32afec5c04a22ac5c8ac8fdc634b1ed002f821a` |
| `frontend/dist/index.html` | `8a8efad54260552cbce1588c97fca0fae61828df8fee55753bb1c1f1899818f3` |
| `frontend/dist/admin.html` | `ce4b0eadd499dd2c5e6f98612bdfaa70ef6805c33fe204314f562babbc8ac920` |
| `frontend/dist/assets/BatchFactoryPage-GXII6wh4.js` | `72af68e00cc0c5c566e0523c4c4eb74273e003e448ef51405bb4ae1d312b5d73` |
| `frontend/dist/assets/SettingsPage-_kSBuudt.js` | `f73f162d62c72ef6f1b462a5d97b2e9b2ce0807da12c4e50304ffa0e69a30f2b` |
| `frontend/dist/assets/NovelPanelPage-B2KMzMY-.js` | `ebd8c89ab6a0fba1a3dc9af219266ec4698b27b1f30bc654572e6b13708154ca` |
| `frontend/dist/assets/index-DraJ9do1.js` | `0b577168dd3f02a8b3cbfa8bd372e8f96fc40286c0d983952fb1063f956339fd` |
| `frontend/dist/assets/user-C-uPVKHM.css` | `dc44fd7d2370ab46fc44c153ae153671ae1f3c96188603720cbbc4ce1afad029` |

The image contains no Vite manifest file; that item is unavailable. The 88 extracted files under `frontend/dist/` are the authoritative production static resource set.
