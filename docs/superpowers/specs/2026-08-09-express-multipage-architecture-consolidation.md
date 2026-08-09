# Express Multipage Architecture Consolidation

## Goal

Stabilize the current `qiantie` application around the architecture the project is already moving toward:

- Backend uses Express.
- Pages are served as separate routes.
- The home page is not a single-page app shell.
- Documentation describes the current architecture, not the older hand-written Node server.

This design intentionally does not change prompt behavior. The known conflict between `通用规则.md` and `爆款开头.md` is out of scope for this pass.

## Current Problems

The project is halfway through an architecture migration.

The current server is Express-based and routes pages through `routes/pages.js`, but `docs/技术文档.md` still describes a zero-dependency, hand-written Node server that uses `X-Auth-Token`.

The current UI has both real pages and SPA remnants. `/script`, `/agent`, and `/tts` are available as separate pages, but `index.html` still contains embedded `page-script` and `page-agent` sections and uses `data-page` navigation for in-page switching.

Login exists, but user data isolation is not complete. API configuration and generated history still use global files. This is documented as the next priority, not solved in this pass.

## Scope

### In Scope

- Keep Express as the backend framework.
- Make `/` a real home page only.
- Keep `/script`, `/agent`, and `/tts` as separate pages.
- Remove SPA-style page switching from the home page.
- Make sidebar and quick actions navigate by URL instead of switching hidden sections.
- Update technical documentation to match Express, route modules, Bearer auth, static assets, and page routes.
- Add a short known-issues section for user-data isolation and stale test scripts.

### Out of Scope

- Prompt architecture changes.
- AI generation behavior changes.
- Per-user config/history isolation implementation.
- Authentication hardening beyond documenting current behavior.
- Visual redesign.
- TTS provider replacement.

## Target Page Architecture

Express serves four user-facing pages:

| Route | File | Purpose |
| --- | --- | --- |
| `/` | `index.html` | Home dashboard and navigation entry points |
| `/script` | `views/script.html` | Novel extraction and script generation workflow |
| `/agent` | `views/agent.html` | Agent workspace placeholder |
| `/tts` | `views/tts.html` | Voice generation workspace |

The home page must not contain `page-script` or `page-agent`. Those sections belong only in their dedicated view files.

Navigation uses real route changes:

- Home to script: `/script`
- Home to agent: `/agent`
- Home to TTS: `/tts`
- Sidebar links use `data-href` consistently.

## Shared Frontend Responsibilities

`public/js/common.js` remains the shared browser script for:

- Theme switching.
- Sidebar collapse and mobile overlay behavior.
- `data-href` navigation.
- API settings modal.
- Login state and Bearer token handling.
- Toast messages.

`public/js/script.js` is only loaded by `views/script.html`.

`public/js/tts.js` is only loaded by `views/tts.html`.

The home page should not depend on script-generation DOM IDs such as `novel-input`, `output-area`, `char-list`, or `scene-list`.

## Backend Architecture

The backend remains Express.

`server.js` is the app composition root:

- Creates the Express app.
- Applies JSON body parsing and static file serving.
- Mounts route modules.
- Starts the server.

Route modules keep their current responsibilities:

- `routes/pages.js`: HTML pages.
- `routes/auth.js`: login.
- `routes/config.js`: API configuration.
- `routes/chat.js`: upstream AI proxy and test endpoint.
- `routes/prompt.js`: prompt file loading.
- `routes/history.js`: generated output history.
- `routes/tts.js`: TTS proxy.

No return to the old hand-written HTTP router is planned.

## Documentation Updates

`docs/技术文档.md` should be updated to state:

- Backend uses Express.
- `package.json` depends on Express.
- Page routes are real server routes.
- API auth uses `Authorization: Bearer <token>`.
- Static assets live under `public/`.
- View files live under `views/`.
- Request body limit is currently `50mb`.
- User data isolation is not yet complete.

The document must stop claiming:

- Zero third-party dependencies.
- No Express/Koa/Fastify.
- `X-Auth-Token` auth.
- Hand-written `routeRequest`.
- Single-file SPA as the current frontend architecture.

## Known Issues Left For Next Pass

### P0: User Data Isolation

Current login does not fully isolate users. `api-config.json`, `outputs/index.json`, and generated output files are global. The next pass should decide the storage layout, likely:

```text
data/users/<username>/api-config.json
data/users/<username>/outputs/index.json
data/users/<username>/outputs/<id>.txt
```

### P1: Stale Test Scripts

`test-gen.js` still uses old `X-Auth-Token` behavior and should be updated or removed in a later pass.

### P1: Dirty Workspace Cleanup

Debug artifacts and generated binary/log files should be reviewed before committing implementation work.

## Verification

After implementation, verify:

- `node -c server.js`
- `node -c public/js/common.js`
- `node -c public/js/script.js`
- Start the server with `npm start`.
- `GET /` returns the home page.
- `GET /script` returns the script page.
- `GET /agent` returns the agent page.
- `GET /tts` returns the TTS page.
- Home page no longer contains `id="page-script"` or `id="page-agent"`.
- `/script` still contains the script-generation workflow.
- Anonymous `GET /api/config` returns `401`.

## Acceptance Criteria

- The codebase has one clear page model: Express-served multipage pages.
- `index.html` is no longer a SPA container for script and agent pages.
- Navigation between major sections uses real routes.
- Documentation matches the current Express implementation.
- Remaining user-isolation and test-script issues are explicitly recorded for the next pass.
