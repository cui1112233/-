# Pixiu Multi-Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second Pixiu desktop pet that the current account can select in Settings, with Golang as the authoritative persistence layer while reusing CM's existing runtime behavior for phase one.

**Architecture:** Store `pet_id` in a dedicated `user_preferences` table, aggregate it through the existing Go `/api/config` endpoint, and keep the React pet catalog purely visual. The runtime pet component continues to own chat/Agent/drag state and swaps only its pet definition, so switching appearance does not reset the assistant session.

**Tech Stack:** Go 1.23, MySQL migrations, net/http + chi, React, Ant Design, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-29-pixiu-multi-pet-design.md`

## Global Constraints

- API authority is Golang; Node/Express must not become the pet preference source of truth.
- User UI and admin UI are React + Ant Design.
- Supported pet IDs in phase one are exactly `stacky` and `pixiu`.
- Default pet ID is `stacky`.
- Phase one reuses existing CM behavior/state/chat/Agent lifecycle; only the visual pet definition changes.
- Existing API key/model settings must remain intact when pet selection changes.
- Work only on `feature/02-pixiu-pet-switcher`; do not write to `master`.

---

### Task 1: Define and test the Go pet catalog

**Files:**
- Create: `backend/internal/pet/catalog.go`
- Create: `backend/internal/pet/catalog_test.go`

**Interfaces:**
- Produces: `pet.DefaultID string`, `pet.NormalizeID(value string, fallback string) string`, `pet.IsSupported(value string) bool`.

- [ ] **Step 1: Write failing tests** for `stacky`, `pixiu`, unknown values, and fallback behavior.
- [ ] **Step 2: Run** `cd backend && go test ./internal/pet` and verify RED because the package implementation does not exist yet.
- [ ] **Step 3: Implement the minimal catalog** with exactly `stacky` and `pixiu`.
- [ ] **Step 4: Re-run** `cd backend && go test ./internal/pet` and verify PASS.
- [ ] **Step 5: Commit** `test/feat: add Go pet catalog`.

### Task 2: Persist per-user pet preference

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/storage/migrations_test.go`
- Create: `backend/internal/store/preferences.go`

**Interfaces:**
- Produces: `store.PreferenceStore` concrete methods `GetPet(ctx context.Context, userID int64) (string, error)` and `SavePet(ctx context.Context, userID int64, petID string) error`.

- [ ] **Step 1: Add a failing migration test** requiring migration 28 to create `user_preferences`, `user_id BIGINT PRIMARY KEY`, `pet_id VARCHAR(32) NOT NULL DEFAULT 'stacky'`, and a cascading users FK.
- [ ] **Step 2: Run** `cd backend && go test ./internal/storage -run UserPreference -v` and verify RED.
- [ ] **Step 3: Add migration 28** with a single idempotent `CREATE TABLE IF NOT EXISTS user_preferences` statement.
- [ ] **Step 4: Implement `store.Preferences`** so missing rows return `stacky` and saves use an upsert.
- [ ] **Step 5: Run storage/store tests** and verify PASS.

### Task 3: Make Go `/api/config` authoritative for pet selection

**Files:**
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/config_handlers.go`
- Create: `backend/internal/httpapi/config_handlers_test.go`
- Modify: `backend/internal/app/app.go`

**Interfaces:**
- `Dependencies.Preferences` implements a new `PreferenceStore` interface.
- `GET /api/config` adds `pet` as a string ID.
- `POST /api/config` accepts `pet` as a string ID.

- [ ] **Step 1: Write handler tests** using fake config/preference stores. Test GET pet response, saving `pixiu`, and unknown ID preserving the previous valid pet.
- [ ] **Step 2: Run** the focused handler tests and verify RED.
- [ ] **Step 3: Add `PreferenceStore` dependency**, instantiate `store.NewPreferences(db)` in `app.New`, and wire it into `httpapi.Dependencies`.
- [ ] **Step 4: Extend `configRequest` with `Pet string`**, normalize with the Go pet catalog, save preference only after reading the current preference, and return the selected ID from `writePublicConfig`.
- [ ] **Step 5: Re-run focused tests** and verify PASS.

### Task 4: Align React with the Go contract

**Files:**
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Verify/modify: `frontend/src/shared/pet/petCatalog.js`
- Verify/modify: `frontend/src/shared/pet/petCatalog.test.js`
- Verify/modify: `frontend/src/shared/pet/StackyPet.jsx`

**Interfaces:**
- Settings sends `{ pet: pet.id }`, never the full client pet object.
- The Go response `pet` string is resolved via `getPetDefinition`.

- [ ] **Step 1: Update/add frontend tests** to require exactly two pets and fallback to Stacky for unknown IDs.
- [ ] **Step 2: Run pet frontend tests** and record RED only if contract mismatch remains.
- [ ] **Step 3: Change Settings save payload** to `pet: pet.id`.
- [ ] **Step 4: Confirm `StackyPet` loads `config.pet` and listens to `PET_SELECTION_EVENT` without remounting its chat/task state.
- [ ] **Step 5: Run pet frontend tests and frontend build** and verify PASS.

### Task 5: Remove Node pet persistence drift

**Files:**
- Revert pet-only changes in: `routes/config.js`
- Delete if branch-only: `lib/pet-catalog.js`
- Delete if branch-only: `test/pet-config.test.js`

**Interfaces:**
- Node remains legacy/gateway code and is no longer the authoritative pet preference implementation.

- [ ] **Step 1: Compare the three files with `master`** to isolate pet-only branch changes.
- [ ] **Step 2: Restore `routes/config.js` to master behavior** and delete branch-only Node pet catalog/tests.
- [ ] **Step 3: Run the root test suite** to ensure legacy behavior remains stable.

### Task 6: Verify Pixiu runtime resource contract

**Files:**
- Verify: `pets/pixiu/spritesheet.svg`
- Create: `pets/pixiu/pet.json`
- Verify: `frontend/src/shared/pet/petCatalog.js`

**Interfaces:**
- `pixiu` visual profile points at a real served asset and uses `stacky-v2` behavior contract in phase one.

- [ ] **Step 1: Add `pet.json` metadata** for Pixiu with phase-one atlas/behavior/speech profiles.
- [ ] **Step 2: Confirm the spritesheet path matches the catalog and the `/pets` static mount.
- [ ] **Step 3: Keep generated high-detail animation sheets as art-source references, not direct runtime frames, until they are normalized into a production atlas with fixed per-frame anchors.

### Task 7: Feature verification and cleanup

**Files:**
- Temporarily modify: `.github/workflows/pet-feature-verify.yml`
- Delete at completion: `.github/workflows/pet-feature-verify.yml`

**Interfaces:**
- CI must run `cd backend && go test ./...`, pet frontend tests, frontend build, and root tests.

- [ ] **Step 1: Update temporary workflow** to add Go 1.23 setup and `go test ./...`, and remove the obsolete Node pet-specific test path.
- [ ] **Step 2: Push changes and inspect the workflow run**; fix any failures using TDD/debugging rather than guessing.
- [ ] **Step 3: Run final verification again after fixes.**
- [ ] **Step 4: Delete the temporary workflow** so it does not remain in the final feature diff.
- [ ] **Step 5: Compare branch against its intended base and report changed files, tests, and any asset limitation clearly.
