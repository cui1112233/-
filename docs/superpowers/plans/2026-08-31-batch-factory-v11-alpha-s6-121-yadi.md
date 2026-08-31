# Batch Factory V11 Alpha Slice 6: 121 And Yadi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separately gated 121 and Yadi external-submission workflows with owner-scoped encrypted credentials, explicit submission confirmation, durable redacted audits, and no plaintext or silent outbound calls.

**Architecture:** 121 and Yadi are independent Go adapters, not extensions of production or merge. Go persists encrypted credentials only with a configured server key, creates a confirmable submission intent, verifies an explicit confirmation, checks the feature gate before any credential/transport work, and records a redacted audit trail. Node only proxies authenticated requests.

**Tech Stack:** Go 1.23, MySQL 8.4, AES-256-GCM credential encryption, Go HTTP provider adapters, React 18.

## Global Constraints

- Slice 5 must be released and its rollback manifest accepted first.
- `publish.121` and `publish.yadi` default to unavailable, independently of all other V11 capabilities.
- Credential save fails closed without `QIANTIE_BATCH_FACTORY_V11_CREDENTIALS_KEY`; plaintext fallback is prohibited.
- A submission requires a previously created intent plus explicit confirm action; a boolean embedded in the first request is insufficient.
- Gate checks occur before credential lookup, endpoint construction, DNS lookup, or adapter transport.
- Audits contain IDs, timestamps, action/outcome, and bounded error/reference values; never credentials or full sensitive payloads.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/external/crypto.go`, `credentials.go`, `intents.go`, `audit.go`, `provider_121.go`, `provider_yadi.go`.
- Create: corresponding `*_test.go` files under `backend/internal/batchfactoryv11/external/`.
- Create: `backend/internal/httpapi/batch_factory_v11_external.go`, `batch_factory_v11_external_test.go`.
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`, `backend/internal/batchfactoryv11/capabilities.go`, `backend/internal/httpapi/router.go`.
- Create: `frontend/src/user/pages/batch-factory-v11/ExternalPublishPanel.jsx`, `CredentialDrawer.jsx`, `SubmissionConfirmDialog.jsx`, `externalState.js`, `externalState.test.js`.
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`.

### Task 1: Add encrypted credential, intent, and audit persistence

**Files:**
- Create: `backend/internal/batchfactoryv11/external/crypto.go`, `credentials.go`, `intents.go`, `audit.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Test: `backend/internal/batchfactoryv11/external/crypto_test.go`, `credentials_test.go`, `intents_test.go`, `audit_test.go`

**Interfaces:**
- `EncryptCredential(key []byte, plaintext []byte) (Ciphertext, error)` and `DecryptCredential(...)` use AES-256-GCM with a versioned key ID.
- `SaveCredential(ctx, ownerID, provider string, input CredentialInput) (CredentialRef, error)` stores ciphertext only.
- `CreateSubmissionIntent(ctx, ownerID, provider, batchID, bookID string) (SubmissionIntent, error)` returns an expiry and immutable payload digest.
- `ConfirmSubmissionIntent(ctx, ownerID, intentID string) (SubmissionIntent, error)` records confirmation before adapter work.

- [ ] **Step 1: Write failing encryption and confirmation tests**

```go
func TestCredentialSaveFailsWithoutEncryptionKey(t *testing.T) {
    _, err := service.SaveCredential(ctx, ownerID, "yadi", CredentialInput{Token: "secret"})
    assert.ErrorContains(t, err, "encryption key")
}

func TestStoredCredentialDoesNotContainPlaintext(t *testing.T) {
    ref := saveCredential(t, "121", "secret-value")
    raw := loadStoredCredentialRow(t, ref.ID)
    assert.NotContains(t, raw.Ciphertext, "secret-value")
}

func TestUnconfirmedIntentCannotSubmit(t *testing.T) {
    intent := createIntent(t, "121")
    assert.ErrorContains(t, submitIntent(t, intent.ID), "confirmation")
}
```

- [ ] **Step 2: Run tests and confirm missing external package**

Run: `cd backend && go test ./internal/batchfactoryv11/external -run 'TestCredentialSaveFailsWithoutEncryptionKey|TestStoredCredentialDoesNotContainPlaintext|TestUnconfirmedIntentCannotSubmit' -count=1`

Expected: FAIL with missing package.

- [ ] **Step 3: Implement tables and AES-GCM encryption**

Create credential, submission-intent, submission-audit, and provider-reference
tables. Use a 32-byte decoded server key plus random nonce per encryption,
store only key ID/nonce/ciphertext, and redact input in audit output. Intent
payloads contain only frozen V11 data needed for submission and a digest; they
expire within fifteen minutes and are single-confirmation/single-submit.

- [ ] **Step 4: Run external persistence tests**

Run: `cd backend && go test ./internal/batchfactoryv11/external -count=1`

Expected: PASS; no plaintext is stored or returned, expired/cross-owner intents
fail, and audit rows are redacted.

- [ ] **Step 5: Commit encrypted persistence**

```bash
git add backend/internal/batchfactoryv11/external backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): add encrypted external submission state"
```

### Task 2: Implement independently gated 121 and Yadi Go adapters

**Files:**
- Create: `backend/internal/batchfactoryv11/external/provider_121.go`, `provider_yadi.go`
- Create: `backend/internal/httpapi/batch_factory_v11_external.go`, `batch_factory_v11_external_test.go`
- Modify: `backend/internal/batchfactoryv11/capabilities.go`, `backend/internal/httpapi/router.go`
- Test: `backend/internal/batchfactoryv11/external/provider_121_test.go`, `provider_yadi_test.go`

**Interfaces:**
- `Provider.Submit(ctx, credential Credential, intent SubmissionIntent) (ProviderReference, error)`.
- HTTP: credential CRUD with redacted response; `POST /publish/{provider}/intents`; `POST /publish/{provider}/intents/{intentId}/confirm`; `POST /publish/{provider}/intents/{intentId}/submit`.
- Feature gates: `BATCH_FACTORY_V11_121_ENABLED` and `BATCH_FACTORY_V11_YADI_ENABLED` are independent and default false.

- [ ] **Step 1: Write failing no-outbound and cross-provider tests**

```go
func TestDisabledYadiGateStopsBeforeCredentialAndTransport(t *testing.T) {
    adapter := &countingProvider{}
    err := service.Submit(ctx, ownerID, "yadi", confirmedIntentID)
    assert.ErrorContains(t, err, "not enabled")
    assert.Zero(t, adapter.Calls)
    assert.Zero(t, credentialStore.LoadCalls)
}

func Test121IntentCannotBeSubmittedByYadiRoute(t *testing.T) {
    response := post(t, "/api/batch-factory/v11/publish/yadi/intents/"+intent121.ID+"/submit")
    assert.Equal(t, http.StatusConflict, response.Code)
}
```

- [ ] **Step 2: Run tests and confirm provider adapters/routes do not exist**

Run: `cd backend && go test ./internal/batchfactoryv11/external ./internal/httpapi -run 'TestDisabledYadiGateStopsBeforeCredentialAndTransport|Test121IntentCannotBeSubmittedByYadiRoute' -count=1`

Expected: FAIL with missing adapter or route.

- [ ] **Step 3: Implement gate-first provider handling and audit outcomes**

Check provider gate before the credential store and before endpoint construction.
Require confirmed, unexpired owner intent with a matching provider. Decrypt only
inside the adapter call, zero the plaintext buffer when possible, and store a
provider reference plus bounded outcome. A retry creates a new intent/audit
chain; it never resends an already-submitted intent automatically.

- [ ] **Step 4: Run no-outbound, handler, and audit tests**

Run:

```bash
cd backend
go test ./internal/batchfactoryv11/external -run 'Test.*Gate|Test.*Intent|Test.*Credential|Test.*Audit' -count=1
go test ./internal/httpapi -run 'Test.*V11.*121|Test.*V11.*Yadi' -count=1
```

Expected: PASS; disabled paths prove zero credential/transport calls, enabled
fake-adapter paths require confirmation and produce redacted audit records.

- [ ] **Step 5: Commit external Go API**

```bash
git add backend/internal/batchfactoryv11/external backend/internal/httpapi
git commit -m "feat(batch-v11): add gated 121 and yadi submission APIs"
```

### Task 3: Add credential, confirmation, and audit UI without fake readiness

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/ExternalPublishPanel.jsx`, `CredentialDrawer.jsx`, `SubmissionConfirmDialog.jsx`, `externalState.js`, `externalState.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`

**Interfaces:**
- Credential responses never contain token/plaintext; UI holds plaintext only until the save request finishes.
- A submit button first requests an intent, then opens the explicit confirmation dialog, then confirms/submits the intent ID.
- `CapabilityAction` uses `publish.121` and `publish.yadi` independently.

- [ ] **Step 1: Write failing UI-state tests**

```js
test('external submit requires an intent confirmation stage', () => {
  assert.equal(nextSubmissionState({ phase: 'draft' }, 'create-intent').phase, 'confirm');
  assert.equal(nextSubmissionState({ phase: 'confirm' }, 'submit').phase, 'submitting');
});

test('redacted credential response never renders a secret field', () => {
  assert.equal(renderCredential({ provider: 'yadi', configured: true }).includes('secret'), false);
});
```

- [ ] **Step 2: Run tests and confirm UI modules are missing**

Run: `node --test frontend/src/user/pages/batch-factory-v11/externalState.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement distinct 121/Yadi panels**

Show unavailable reason until Go capability is true. A configured credential is
shown only as provider/name/update time. The confirmation dialog identifies the
provider, current Book, frozen content digest, and that an external action will
occur. Render audit status/outcome after submission; never render a fake queued
or success result.

- [ ] **Step 4: Run tests, build, and fake-provider acceptance**

Run: `node --test frontend/src/user/pages/batch-factory-v11/externalState.test.js && npm --prefix frontend run build`

Acceptance: key missing credential save fails; disabled provider cannot create
transport; configured fake provider requires intent plus confirm; audit survives
refresh/restart; 121 and Yadi remain isolated.

- [ ] **Step 5: Commit external UI**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11): add confirmed external publish controls"
```

### Task 4: Release Slice 6 and complete V11 Alpha feature rollout

- [ ] **Step 1: Run full tests/build and a no-outbound regression suite**

Run: `cd backend && go test ./... && cd .. && npm --prefix frontend run build`

Expected: PASS. The no-outbound suite must demonstrate that both gates block
credential lookup and adapter transport.

- [ ] **Step 2: Release immutable images and backup through the Alpha script**

Do not enable real 121/Yadi gate values merely by deploying code. Record each
gate/credential configuration state separately in the release manifest.

- [ ] **Step 3: Verify live Alpha behavior and explicit confirmation**

Use a controlled provider test account first. Confirm user-visible intent,
explicit confirmation, redacted audit, success/failure, refresh/restart, and
rollback behavior. No external production submission occurs without the user
confirming the live dialog.

- [ ] **Step 4: Commit release evidence and stop**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice six release"
```

V11 feature rollout is complete only after this evidence exists. Legacy import
remains a separate reviewed operation.
