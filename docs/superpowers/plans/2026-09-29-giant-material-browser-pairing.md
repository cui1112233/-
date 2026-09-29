# Giant Material Browser Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreliable Windows-native pairing dialog with an EXE-launched, loopback-only browser pairing page.

**Architecture:** The existing loopback server serves a static `/setup` page and accepts a same-origin pairing request containing a code and a validated public API address. The Windows executable starts that server, opens the browser page, and continues to run the resident OCR agent after successful pairing.

**Tech Stack:** Go 1.23 standard `net/http`, executor `httpapi`, Windows `rundll32.exe`, existing ZIP packaging script.

## Global Constraints

- Keep the service bound only to `127.0.0.1:17861`.
- Do not change public executor pairing, heartbeat, claim, or result contracts.
- Do not bundle Python, OCR packages, or OCR model files.
- The local setup page has no remote resources and never reads browser cookies.
- Keep the package Windows x64 and GUI-first; final Windows interaction requires user-side validation.

---

### Task 1: Serve and test the loopback setup page

**Files:**
- Modify: `giant-material-executor/internal/httpapi/server.go`
- Modify: `giant-material-executor/internal/httpapi/server_test.go`

**Interfaces:**
- Produces `GET /setup` with an HTML form and JavaScript that POSTs to `/v1/pair`.
- Produces a same-origin allowance for `http://127.0.0.1:17861` only.

- [ ] **Step 1: Write the failing test**

    func TestSetupPageIsServedFromLoopback(t *testing.T) {
        server, _ := NewServer(ServerConfig{Addr: "127.0.0.1:17861", Origin: "https://example.com", Nonce: "nonce"})
        rec := httptest.NewRecorder()
        server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/setup", nil))
        if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "巨量素材执行器") { t.Fatal(rec.Body.String()) }
    }

- [ ] **Step 2: Run the test and verify it fails**

    go test ./internal/httpapi -run TestSetupPageIsServedFromLoopback

Expected: `/setup` is not registered.

- [ ] **Step 3: Implement the route and origin boundary**

    mux.HandleFunc("GET /setup", s.setupPage)
    localOrigin := "http://127.0.0.1:17861"
    originOK := req.Header.Get("Origin") == s.config.Origin || req.Header.Get("Origin") == localOrigin

The page has `publicURL` and `code` inputs, immediate submitting/error text, and a one-second health poll. It posts same-origin JSON to `/v1/pair`.

- [ ] **Step 4: Verify and commit**

    go test ./internal/httpapi && go test ./...
    git add giant-material-executor/internal/httpapi/server.go giant-material-executor/internal/httpapi/server_test.go
    git commit -m "feat(executor): serve loopback pairing page"

---

### Task 2: Carry the browser-selected API address into pairing

**Files:**
- Modify: `giant-material-executor/internal/httpapi/server.go`
- Modify: `giant-material-executor/internal/httpapi/server_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`

**Interfaces:**
- Extends `Callbacks` with `SetPublicURL func(string) error`.
- `/v1/pair` accepts JSON `code` plus `publicURL` and calls `SetPublicURL` before `Pair`.

- [ ] **Step 1: Write the failing test**

    func TestPairingPersistsBrowserSelectedPublicURLBeforePair(t *testing.T) {
        var saved string
        server, _ := NewServer(ServerConfig{Addr: "127.0.0.1:17861", Origin: "https://example.com", Nonce: "nonce", Callbacks: Callbacks{
            SetPublicURL: func(value string) error { saved = value; return nil },
            Pair: func(context.Context, string) error { return nil },
        }})
        // Post local-origin JSON containing code and publicURL, then assert saved.
        if saved != "https://factory.example.com" { t.Fatal("address not saved") }
    }

- [ ] **Step 2: Run test and verify it fails**

    go test ./internal/httpapi -run TestPairingPersistsBrowserSelectedPublicURLBeforePair

Expected: the request body does not expose `publicURL` to the callback.

- [ ] **Step 3: Implement minimal request extension**

    var input struct { Code string; PublicURL string }
    if strings.TrimSpace(input.PublicURL) != "" && s.config.Callbacks.SetPublicURL != nil {
        if err := s.config.Callbacks.SetPublicURL(strings.TrimSpace(input.PublicURL)); err != nil { /* write 400 */ }
    }

Pass `setPublicURL` into `httpapi.Callbacks` in main; retain credential storage and public pairing client.

- [ ] **Step 4: Verify and commit**

    go test ./internal/httpapi && go test ./...
    git add giant-material-executor/internal/httpapi/server.go giant-material-executor/internal/httpapi/server_test.go giant-material-executor/cmd/giant-material-executor/main.go
    git commit -m "feat(executor): accept loopback pairing endpoint"

---

### Task 3: Launch the setup page from the Windows EXE and package it

**Files:**
- Create: `giant-material-executor/internal/browserui/open_windows.go`
- Create: `giant-material-executor/internal/browserui/open_other.go`
- Create: `giant-material-executor/internal/browserui/open_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`
- Modify: `giant-material-executor/portable/README-Windows.txt`
- Modify: `frontend/public/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip`

**Interfaces:**
- `browserui.Open("http://127.0.0.1:17861/setup") error` starts the default Windows browser without opening a command shell.
- Main starts the loopback listener before calling `browserui.Open`.

- [ ] **Step 1: Write the failing test**

    func TestSetupURLIsLoopbackOnly(t *testing.T) {
        if got := SetupURL("127.0.0.1:17861"); got != "http://127.0.0.1:17861/setup" { t.Fatalf("URL=%q", got) }
    }

- [ ] **Step 2: Run test and verify it fails**

    go test ./internal/browserui -run TestSetupURLIsLoopbackOnly

Expected: package does not exist.

- [ ] **Step 3: Implement browser opening**

    //go:build windows
    func Open(url string) error { return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start() }

The non-Windows implementation returns nil. Main logs browser-open failure and the manual setup URL.

- [ ] **Step 4: Replace the native UI launch and update the package**

Remove the `internal/ui` runtime launch. README instructs users to double-click the EXE and complete pairing in the browser page.

- [ ] **Step 5: Verify and commit**

    go test ./...
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c -o /tmp/giant-httpapi.test.exe ./internal/httpapi
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w -H=windowsgui -X main.version=0.2.0' -o /tmp/GiantMaterialExecutor.exe ./cmd/giant-material-executor
    unzip -t frontend/public/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip
    curl -fsSI http://127.0.0.1:5173/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip
    git add giant-material-executor frontend/public/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip
    git commit -m "feat(executor): open browser pairing interface"
