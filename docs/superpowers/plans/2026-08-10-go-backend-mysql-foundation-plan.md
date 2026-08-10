# Go Backend MySQL Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go binary backend foundation with MySQL-backed users, API config, history, and legacy JSON import while keeping the existing Express app available.

**Architecture:** Add a new `backend/` Go service beside the current Node/Express app. The first phase implements auth, MySQL storage, config/history APIs, health checks, and legacy import; prompt generation and React + Antd are separate follow-up plans after this API shape is stable.

**Tech Stack:** Go, `net/http`, `github.com/go-chi/chi/v5`, MySQL, `github.com/go-sql-driver/mysql`, SQL migrations, Go tests.

---

## Scope Boundary

This plan intentionally implements only the backend/data foundation from `docs/go-react-mysql-refactor-design.md`.

Included:
- Go module under `backend/`.
- Single binary entrypoint.
- MySQL schema migrations.
- Login, Bearer token middleware, `/api/me`.
- Per-user API config in MySQL.
- Per-user generation history in MySQL.
- Legacy import from `data/users/<username>/`.
- Static health endpoint and local configuration.

Excluded:
- React + Antd frontend.
- AI generation prompt orchestration.
- TTS proxy migration.
- Replacing or deleting the current Express app.
- Production-grade password reset, account invite flow, OAuth, refresh tokens.

## Reference Notes

- Vite and React/Antd are not implemented in this plan; official docs were checked only to confirm they should be a later frontend plan. Vite currently documents `npm create vite@latest` and Node version requirements, while Ant Design documents npm installation via `npm install antd --save`.
- `chi` is used because its package documentation describes it as a small, idiomatic, composable router for HTTP services.
- Migration behavior follows the `golang-migrate` model: migration files are applied in order, but this plan keeps a small built-in migration runner for phase one to avoid adding another CLI dependency before the backend shape is stable.

## File Structure

- Create: `backend/go.mod`
  - Go module definition and dependencies.
- Create: `backend/cmd/qiantie/main.go`
  - Binary entrypoint and CLI mode dispatch.
- Create: `backend/internal/app/app.go`
  - App wiring: config, database, stores, router.
- Create: `backend/internal/config/config.go`
  - Environment configuration.
- Create: `backend/internal/storage/mysql.go`
  - MySQL connection and migration runner.
- Create: `backend/internal/storage/migrations.go`
  - Ordered SQL migrations.
- Create: `backend/internal/auth/auth.go`
  - Development password hashing, token service, auth middleware.
- Create: `backend/internal/httpapi/router.go`
  - API routes and shared helpers.
- Create: `backend/internal/httpapi/auth_handlers.go`
  - `/api/login`, `/api/logout`, `/api/me`.
- Create: `backend/internal/httpapi/config_handlers.go`
  - `/api/config`, `/api/config/test`.
- Create: `backend/internal/httpapi/history_handlers.go`
  - `/api/history` endpoints.
- Create: `backend/internal/store/users.go`
  - User DB methods.
- Create: `backend/internal/store/configs.go`
  - API config DB methods.
- Create: `backend/internal/store/history.go`
  - History DB methods.
- Create: `backend/internal/legacy/import.go`
  - Import existing file data.
- Create: `backend/internal/legacy/import_test.go`
  - Legacy parsing tests.
- Create: `backend/internal/httpapi/router_test.go`
  - Auth and route behavior tests.
- Create: `backend/.env.example`
  - Local config example.
- Modify: `.gitignore`
  - Ignore backend binary, local env, and coverage files.
- Modify: `README.md`
  - Add Go backend development commands.

---

### Task 1: Scaffold Go Module And Local Config

**Files:**
- Create: `backend/go.mod`
- Create: `backend/cmd/qiantie/main.go`
- Create: `backend/internal/config/config.go`
- Create: `backend/.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `backend/go.mod`**

```go
module qiantie/backend

go 1.23

require (
	github.com/go-chi/chi/v5 v5.3.1
	github.com/go-sql-driver/mysql v1.9.3
)
```

- [ ] **Step 2: Create `backend/internal/config/config.go`**

```go
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Addr          string
	MySQLDSN      string
	SeedUsername  string
	SeedPassword  string
	TokenSecret   string
	LegacyDataDir string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:          getenv("QIANTIE_ADDR", "127.0.0.1:4000"),
		MySQLDSN:      getenv("QIANTIE_MYSQL_DSN", ""),
		SeedUsername:  getenv("QIANTIE_SEED_USERNAME", "choushiyiguai"),
		SeedPassword:  getenv("QIANTIE_SEED_PASSWORD", "123456"),
		TokenSecret:   getenv("QIANTIE_TOKEN_SECRET", "dev-token-secret-change-me"),
		LegacyDataDir: getenv("QIANTIE_LEGACY_DATA_DIR", "../data/users"),
	}
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("QIANTIE_MYSQL_DSN is required")
	}
	if cfg.TokenSecret == "" {
		return Config{}, fmt.Errorf("QIANTIE_TOKEN_SECRET is required")
	}
	return cfg, nil
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getenvBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
```

- [ ] **Step 3: Create `backend/cmd/qiantie/main.go`**

```go
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"qiantie/backend/internal/app"
	"qiantie/backend/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	application, err := app.New(cfg)
	if err != nil {
		slog.Error("create app", "error", err)
		os.Exit(1)
	}
	defer application.Close()

	if len(os.Args) > 1 && os.Args[1] == "migrate-legacy" {
		if err := application.ImportLegacy(context.Background(), cfg.LegacyDataDir); err != nil {
			slog.Error("legacy import failed", "error", err)
			os.Exit(1)
		}
		fmt.Println("legacy import completed")
		return
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           application.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		slog.Info("server listening", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 4: Create `backend/.env.example`**

```dotenv
QIANTIE_ADDR=127.0.0.1:4000
QIANTIE_MYSQL_DSN=qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local
QIANTIE_SEED_USERNAME=choushiyiguai
QIANTIE_SEED_PASSWORD=123456
QIANTIE_TOKEN_SECRET=dev-token-secret-change-me
QIANTIE_LEGACY_DATA_DIR=../data/users
```

- [ ] **Step 5: Modify `.gitignore`**

Add this block:

```gitignore
# Go backend local artifacts
backend/.env
backend/qiantie
backend/coverage.out
```

- [ ] **Step 6: Run module download and syntax check**

Run:

```bash
cd backend
go mod tidy
go test ./...
```

Expected:

```text
?   	qiantie/backend/cmd/qiantie	[no test files]
```

The first run may fail because `internal/app` does not exist yet. If it fails with `package qiantie/backend/internal/app is not in std`, continue to Task 2 before committing.

- [ ] **Step 7: Commit scaffold if tests pass after Task 2**

Do not commit Task 1 alone if it cannot compile. Commit together with Task 2 using:

```bash
git add .gitignore backend/go.mod backend/go.sum backend/.env.example backend/cmd/qiantie/main.go backend/internal/config/config.go
git commit -m "feat: scaffold go backend"
```

---

### Task 2: Add App Wiring, Router, And Health Endpoint

**Files:**
- Create: `backend/internal/app/app.go`
- Create: `backend/internal/httpapi/router.go`

- [ ] **Step 1: Create `backend/internal/app/app.go`**

```go
package app

import (
	"context"
	"database/sql"
	"net/http"

	"qiantie/backend/internal/config"
	"qiantie/backend/internal/httpapi"
	"qiantie/backend/internal/legacy"
	"qiantie/backend/internal/storage"
)

type App struct {
	cfg config.Config
	db  *sql.DB
	api *httpapi.API
}

func New(cfg config.Config) (*App, error) {
	db, err := storage.OpenMySQL(cfg.MySQLDSN)
	if err != nil {
		return nil, err
	}
	if err := storage.RunMigrations(context.Background(), db); err != nil {
		db.Close()
		return nil, err
	}
	api := httpapi.New(httpapi.Dependencies{
		DB:           db,
		TokenSecret:  cfg.TokenSecret,
		SeedUsername: cfg.SeedUsername,
		SeedPassword: cfg.SeedPassword,
	})
	return &App{cfg: cfg, db: db, api: api}, nil
}

func (a *App) Router() http.Handler {
	return a.api.Router()
}

func (a *App) ImportLegacy(ctx context.Context, sourceDir string) error {
	return legacy.Import(ctx, a.db, sourceDir)
}

func (a *App) Close() error {
	if a.db == nil {
		return nil
	}
	return a.db.Close()
}
```

- [ ] **Step 2: Create `backend/internal/httpapi/router.go`**

```go
package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Dependencies struct {
	DB           *sql.DB
	TokenSecret  string
	SeedUsername string
	SeedPassword string
}

type API struct {
	deps Dependencies
}

func New(deps Dependencies) *API {
	return &API{deps: deps}
}

func (api *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", api.handleHealth)
	r.Route("/api", func(r chi.Router) {
		r.Post("/login", api.handleLogin)
		r.Post("/logout", api.handleLogout)
		r.With(api.requireAuth).Get("/me", api.handleMe)
		r.With(api.requireAuth).Get("/config", api.handleGetConfig)
		r.With(api.requireAuth).Post("/config", api.handleSaveConfig)
		r.With(api.requireAuth).Post("/config/test", api.handleTestConfig)
		r.With(api.requireAuth).Get("/history", api.handleListHistory)
		r.With(api.requireAuth).Post("/history", api.handleSaveHistory)
		r.With(api.requireAuth).Get("/history/{id}", api.handleGetHistory)
		r.With(api.requireAuth).Delete("/history/{id}", api.handleDeleteHistory)
		r.With(api.requireAuth).Delete("/history", api.handleClearHistory)
	})
	return r
}

func (api *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(target)
}
```

- [ ] **Step 3: Add temporary handler stubs**

Create these minimal methods in `backend/internal/httpapi/router.go` below `readJSON` so the app compiles before later tasks fill behavior:

```go
func (api *API) handleLogin(w http.ResponseWriter, r *http.Request)       { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleLogout(w http.ResponseWriter, r *http.Request)      { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) }
func (api *API) handleMe(w http.ResponseWriter, r *http.Request)          { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request)   { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request)  { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request)  { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleListHistory(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleSaveHistory(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleGetHistory(w http.ResponseWriter, r *http.Request)  { writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"}) }
func (api *API) handleDeleteHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}
func (api *API) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not implemented"})
}
func (api *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
	})
}
```

- [ ] **Step 4: Run syntax check**

Run:

```bash
cd backend
go test ./...
```

Expected:

```text
?   	qiantie/backend/cmd/qiantie	[no test files]
?   	qiantie/backend/internal/app	[no test files]
?   	qiantie/backend/internal/config	[no test files]
?   	qiantie/backend/internal/httpapi	[no test files]
```

It may still fail because storage and legacy packages do not exist. Continue to Task 3 before committing if so.

---

### Task 3: Add MySQL Connection And Migrations

**Files:**
- Create: `backend/internal/storage/mysql.go`
- Create: `backend/internal/storage/migrations.go`

- [ ] **Step 1: Create `backend/internal/storage/mysql.go`**

```go
package storage

import (
	"context"
	"database/sql"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

func OpenMySQL(dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
```

- [ ] **Step 2: Create `backend/internal/storage/migrations.go`**

```go
package storage

import (
	"context"
	"database/sql"
	"fmt"
)

type migration struct {
	version int
	sql     string
}

var migrations = []migration{
	{version: 1, sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 2, sql: `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 3, sql: `
CREATE TABLE IF NOT EXISTS api_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  provider VARCHAR(64) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  model VARCHAR(128) NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_config (user_id),
  CONSTRAINT fk_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
	{version: 4, sql: `
CREATE TABLE IF NOT EXISTS generation_histories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  external_id VARCHAR(64) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  format VARCHAR(32) NOT NULL,
  format_name VARCHAR(64) NOT NULL,
  duration VARCHAR(16) NOT NULL,
  preview VARCHAR(255) NOT NULL,
  output MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_external_id (user_id, external_id),
  KEY idx_user_created_at (user_id, created_at),
  CONSTRAINT fk_generation_histories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`},
}

func RunMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, migrations[0].sql); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	for _, m := range migrations[1:] {
		var exists int
		err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", m.version).Scan(&exists)
		if err != nil {
			return fmt.Errorf("check migration %d: %w", m.version, err)
		}
		if exists > 0 {
			continue
		}
		if _, err := db.ExecContext(ctx, m.sql); err != nil {
			return fmt.Errorf("run migration %d: %w", m.version, err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(?)", m.version); err != nil {
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
	}
	return nil
}
```

- [ ] **Step 3: Run compile check**

Run:

```bash
cd backend
go test ./...
```

Expected: compile succeeds except for missing `legacy` package if Task 4 has not been created.

---

### Task 4: Add Legacy Import Package Skeleton

**Files:**
- Create: `backend/internal/legacy/import.go`
- Create: `backend/internal/legacy/import_test.go`

- [ ] **Step 1: Create `backend/internal/legacy/import.go`**

```go
package legacy

import (
	"context"
	"database/sql"
)

func Import(ctx context.Context, db *sql.DB, sourceDir string) error {
	_ = ctx
	_ = db
	_ = sourceDir
	return nil
}
```

- [ ] **Step 2: Create `backend/internal/legacy/import_test.go`**

```go
package legacy

import "testing"

func TestImportSkeleton(t *testing.T) {
	t.Parallel()
}
```

- [ ] **Step 3: Run compile check and commit scaffold**

Run:

```bash
cd backend
go test ./...
```

Expected: all packages compile.

Commit:

```bash
git add .gitignore backend
git commit -m "feat: scaffold go backend foundation"
```

---

### Task 5: Implement User Store And Seed User

**Files:**
- Create: `backend/internal/store/users.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: Create `backend/internal/store/users.go`**

```go
package store

import (
	"context"
	"database/sql"
	"errors"
)

type User struct {
	ID           int64
	Username     string
	PasswordHash string
}

type Users struct {
	db *sql.DB
}

func NewUsers(db *sql.DB) *Users {
	return &Users{db: db}
}

func (s *Users) EnsureUser(ctx context.Context, username string, passwordHash string) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO users(username, password_hash)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE username = username
`, username, passwordHash)
	return err
}

func (s *Users) FindByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash
FROM users
WHERE username = ?
`, username).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}

func (s *Users) FindByID(ctx context.Context, id int64) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, `
SELECT id, username, password_hash
FROM users
WHERE id = ?
`, id).Scan(&u.ID, &u.Username, &u.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, sql.ErrNoRows
	}
	return u, err
}
```

- [ ] **Step 2: Modify `backend/internal/httpapi/router.go` dependencies**

Replace `Dependencies` with:

```go
type Dependencies struct {
	DB           *sql.DB
	TokenSecret  string
	SeedUsername string
	SeedPassword string
	Users        UserStore
}

type UserStore interface {
	EnsureUser(ctx context.Context, username string, passwordHash string) error
	FindByUsername(ctx context.Context, username string) (store.User, error)
	FindByID(ctx context.Context, id int64) (store.User, error)
}
```

Add imports:

```go
import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)
```

- [ ] **Step 3: Modify `backend/internal/app/app.go` to create user store and seed user**

Add import:

```go
"qiantie/backend/internal/store"
```

Before creating `httpapi.New`, add:

```go
users := store.NewUsers(db)
if err := users.EnsureUser(context.Background(), cfg.SeedUsername, cfg.SeedPassword); err != nil {
	db.Close()
	return nil, err
}
```

Pass it:

```go
api := httpapi.New(httpapi.Dependencies{
	DB:           db,
	TokenSecret:  cfg.TokenSecret,
	SeedUsername: cfg.SeedUsername,
	SeedPassword: cfg.SeedPassword,
	Users:        users,
})
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend
go test ./...
```

Expected: all packages compile.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/store/users.go backend/internal/httpapi/router.go backend/internal/app/app.go
git commit -m "feat: add mysql user store"
```

---

### Task 6: Implement Bearer Login And Auth Middleware

**Files:**
- Create: `backend/internal/auth/auth.go`
- Create: `backend/internal/httpapi/auth_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Test: `backend/internal/httpapi/router_test.go`

- [ ] **Step 1: Create `backend/internal/auth/auth.go`**

```go
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func HashPassword(password string) string {
	sum := sha256.Sum256([]byte(password))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func CheckPassword(password string, passwordHash string) bool {
	return hmac.Equal([]byte(HashPassword(password)), []byte(passwordHash))
}

func NewToken(secret string, userID int64, username string) (string, error) {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	issuedAt := time.Now().Unix()
	payload := fmt.Sprintf("%d:%s:%d:%s", userID, username, issuedAt, base64.RawURLEncoding.EncodeToString(nonce))
	sig := sign(secret, payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig, nil
}

func ParseToken(secret string, token string) (int64, string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid token")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, "", fmt.Errorf("invalid token payload")
	}
	payload := string(payloadBytes)
	if !hmac.Equal([]byte(sign(secret, payload)), []byte(parts[1])) {
		return 0, "", fmt.Errorf("invalid token signature")
	}
	fields := strings.Split(payload, ":")
	if len(fields) != 4 {
		return 0, "", fmt.Errorf("invalid token fields")
	}
	userID, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid user id")
	}
	return userID, fields[1], nil
}

func sign(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
```

- [ ] **Step 2: Create `backend/internal/httpapi/auth_handlers.go`**

```go
package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"qiantie/backend/internal/auth"
	"qiantie/backend/internal/store"
)

type contextKey string

const userContextKey contextKey = "user"

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (api *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	user, err := api.deps.Users.FindByUsername(r.Context(), req.Username)
	if err == sql.ErrNoRows || !auth.CheckPassword(req.Password, user.PasswordHash) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "用户名或密码错误"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Login failed"})
		return
	}
	token, err := auth.NewToken(api.deps.TokenSecret, user.ID, user.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Create token failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "username": user.Username})
}

func (api *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := currentUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": user.Username})
}

func (api *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		token := strings.TrimSpace(authHeader[len("Bearer "):])
		userID, _, err := auth.ParseToken(api.deps.TokenSecret, token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		user, err := api.deps.Users.FindByID(r.Context(), userID)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func currentUser(r *http.Request) (store.User, bool) {
	user, ok := r.Context().Value(userContextKey).(store.User)
	return user, ok
}
```

- [ ] **Step 3: Remove auth stub methods from `router.go`**

Delete these stubs from `backend/internal/httpapi/router.go`:

```go
func (api *API) handleLogin(w http.ResponseWriter, r *http.Request)
func (api *API) handleLogout(w http.ResponseWriter, r *http.Request)
func (api *API) handleMe(w http.ResponseWriter, r *http.Request)
func (api *API) requireAuth(next http.Handler) http.Handler
```

- [ ] **Step 4: Run tests**

```bash
cd backend
go test ./...
```

Expected: all packages compile.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/auth/auth.go backend/internal/httpapi/auth_handlers.go backend/internal/httpapi/router.go
git commit -m "feat: add bearer auth to go backend"
```

---

### Task 7: Implement Config Store And Handlers

**Files:**
- Create: `backend/internal/store/configs.go`
- Create: `backend/internal/httpapi/config_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: Create `backend/internal/store/configs.go`**

```go
package store

import (
	"context"
	"database/sql"
	"errors"
)

type APIConfig struct {
	Provider         string
	BaseURL          string
	Model            string
	APIKeyCiphertext string
}

type Configs struct {
	db *sql.DB
}

func NewConfigs(db *sql.DB) *Configs {
	return &Configs{db: db}
}

func (s *Configs) Get(ctx context.Context, userID int64) (APIConfig, error) {
	var cfg APIConfig
	err := s.db.QueryRowContext(ctx, `
SELECT provider, base_url, model, api_key_ciphertext
FROM api_configs
WHERE user_id = ?
`, userID).Scan(&cfg.Provider, &cfg.BaseURL, &cfg.Model, &cfg.APIKeyCiphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return APIConfig{
			Provider: "openai",
			BaseURL:  "https://api.openai.com/v1",
			Model:    "gpt-4o-mini",
		}, nil
	}
	return cfg, err
}

func (s *Configs) Save(ctx context.Context, userID int64, cfg APIConfig) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO api_configs(user_id, provider, base_url, model, api_key_ciphertext)
VALUES(?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  base_url = VALUES(base_url),
  model = VALUES(model),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, cfg.Provider, cfg.BaseURL, cfg.Model, cfg.APIKeyCiphertext)
	return err
}
```

- [ ] **Step 2: Create `backend/internal/httpapi/config_handlers.go`**

```go
package httpapi

import (
	"net/http"

	"qiantie/backend/internal/store"
)

type ConfigStore interface {
	Get(ctx context.Context, userID int64) (store.APIConfig, error)
	Save(ctx context.Context, userID int64, cfg store.APIConfig) error
}

type configRequest struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
}

func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	cfg, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":  cfg.Provider,
		"baseUrl":   cfg.BaseURL,
		"model":     cfg.Model,
		"hasApiKey": cfg.APIKeyCiphertext != "",
	})
}

func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	oldConfig, err := api.deps.Configs.Get(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read config failed"})
		return
	}
	var req configRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	next := store.APIConfig{
		Provider:         firstNonEmpty(req.Provider, oldConfig.Provider, "openai"),
		BaseURL:          firstNonEmpty(req.BaseURL, oldConfig.BaseURL, "https://api.openai.com/v1"),
		Model:            firstNonEmpty(req.Model, oldConfig.Model, "gpt-4o-mini"),
		APIKeyCiphertext: firstNonEmpty(req.APIKey, oldConfig.APIKeyCiphertext, ""),
	}
	if err := api.deps.Configs.Save(r.Context(), user.ID, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save config failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":  next.Provider,
		"baseUrl":   next.BaseURL,
		"model":     next.Model,
		"hasApiKey": next.APIKeyCiphertext != "",
	})
}

func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Config endpoint is reachable"})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
```

Add missing import to this file:

```go
import "context"
```

- [ ] **Step 3: Modify dependencies and app wiring**

In `backend/internal/httpapi/router.go`, add to `Dependencies`:

```go
Configs ConfigStore
```

In `backend/internal/app/app.go`, create and pass:

```go
configs := store.NewConfigs(db)
```

```go
Configs: configs,
```

- [ ] **Step 4: Remove config handler stubs from `router.go`**

Delete:

```go
func (api *API) handleGetConfig(w http.ResponseWriter, r *http.Request)
func (api *API) handleSaveConfig(w http.ResponseWriter, r *http.Request)
func (api *API) handleTestConfig(w http.ResponseWriter, r *http.Request)
```

- [ ] **Step 5: Run tests**

```bash
cd backend
go test ./...
```

Expected: all packages compile.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/configs.go backend/internal/httpapi/config_handlers.go backend/internal/httpapi/router.go backend/internal/app/app.go
git commit -m "feat: add mysql api config endpoints"
```

---

### Task 8: Implement History Store And Handlers

**Files:**
- Create: `backend/internal/store/history.go`
- Create: `backend/internal/httpapi/history_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: Create `backend/internal/store/history.go`**

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type HistoryEntry struct {
	ID         int64     `json:"-"`
	ExternalID string    `json:"id"`
	Mode       string    `json:"mode"`
	Format     string    `json:"format"`
	FormatName string    `json:"formatName"`
	Duration   string    `json:"duration"`
	Preview    string    `json:"preview"`
	Output     string    `json:"output,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Histories struct {
	db *sql.DB
}

func NewHistories(db *sql.DB) *Histories {
	return &Histories{db: db}
}

func (s *Histories) List(ctx context.Context, userID int64, limit int) ([]HistoryEntry, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, external_id, mode, format, format_name, duration, preview, created_at
FROM generation_histories
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT ?
`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []HistoryEntry
	for rows.Next() {
		var e HistoryEntry
		if err := rows.Scan(&e.ID, &e.ExternalID, &e.Mode, &e.Format, &e.FormatName, &e.Duration, &e.Preview, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Histories) Save(ctx context.Context, userID int64, e HistoryEntry) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO generation_histories(user_id, external_id, mode, format, format_name, duration, preview, output, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  mode = VALUES(mode),
  format = VALUES(format),
  format_name = VALUES(format_name),
  duration = VALUES(duration),
  preview = VALUES(preview),
  output = VALUES(output)
`, userID, e.ExternalID, e.Mode, e.Format, e.FormatName, e.Duration, e.Preview, e.Output, e.CreatedAt)
	return err
}

func (s *Histories) Get(ctx context.Context, userID int64, externalID string) (HistoryEntry, error) {
	var e HistoryEntry
	err := s.db.QueryRowContext(ctx, `
SELECT id, external_id, mode, format, format_name, duration, preview, output, created_at
FROM generation_histories
WHERE user_id = ? AND external_id = ?
`, userID, externalID).Scan(&e.ID, &e.ExternalID, &e.Mode, &e.Format, &e.FormatName, &e.Duration, &e.Preview, &e.Output, &e.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return HistoryEntry{}, sql.ErrNoRows
	}
	return e, err
}

func (s *Histories) Delete(ctx context.Context, userID int64, externalID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM generation_histories WHERE user_id = ? AND external_id = ?", userID, externalID)
	return err
}

func (s *Histories) Clear(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM generation_histories WHERE user_id = ?", userID)
	return err
}
```

- [ ] **Step 2: Create `backend/internal/httpapi/history_handlers.go`**

```go
package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"qiantie/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

type HistoryStore interface {
	List(ctx context.Context, userID int64, limit int) ([]store.HistoryEntry, error)
	Save(ctx context.Context, userID int64, e store.HistoryEntry) error
	Get(ctx context.Context, userID int64, externalID string) (store.HistoryEntry, error)
	Delete(ctx context.Context, userID int64, externalID string) error
	Clear(ctx context.Context, userID int64) error
}

type historyRequest struct {
	ID         string `json:"id"`
	Mode       string `json:"mode"`
	Format     string `json:"format"`
	FormatName string `json:"formatName"`
	Duration   string `json:"duration"`
	Output     string `json:"output"`
}

func (api *API) handleListHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	entries, err := api.deps.Histories.List(r.Context(), user.ID, 50)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (api *API) handleSaveHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	var req historyRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return
	}
	if invalidID(req.ID) || req.Output == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id 和 output 为必填项"})
		return
	}
	entry := store.HistoryEntry{
		ExternalID: req.ID,
		Mode:       firstNonEmpty(req.Mode, "continuous"),
		Format:     firstNonEmpty(req.Format, ""),
		FormatName: firstNonEmpty(req.FormatName, ""),
		Duration:   firstNonEmpty(req.Duration, "10s"),
		Preview:    preview(req.Output),
		Output:     req.Output,
		CreatedAt:  time.Now(),
	}
	if err := api.deps.Histories.Save(r.Context(), user.ID, entry); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Save history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": req.ID})
}

func (api *API) handleGetHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	id := chi.URLParam(r, "id")
	if invalidID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}
	entry, err := api.deps.Histories.Get(r.Context(), user.ID, id)
	if err == sql.ErrNoRows {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "记录不存在"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Read history failed"})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(entry.Output))
}

func (api *API) handleDeleteHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	id := chi.URLParam(r, "id")
	if invalidID(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的 ID"})
		return
	}
	if err := api.deps.Histories.Delete(r.Context(), user.ID, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Delete history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (api *API) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	user, _ := currentUser(r)
	if err := api.deps.Histories.Clear(r.Context(), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Clear history failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func invalidID(id string) bool {
	return id == "" || strings.Contains(id, "..") || strings.Contains(id, "/") || strings.Contains(id, "\\")
}

func preview(output string) string {
	trimmed := strings.ReplaceAll(output, "\n", " ")
	runes := []rune(trimmed)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return trimmed
}
```

- [ ] **Step 3: Modify dependencies and app wiring**

In `backend/internal/httpapi/router.go`, add to `Dependencies`:

```go
Histories HistoryStore
```

In `backend/internal/app/app.go`, create and pass:

```go
histories := store.NewHistories(db)
```

```go
Histories: histories,
```

- [ ] **Step 4: Remove history handler stubs from `router.go`**

Delete all `handleListHistory`, `handleSaveHistory`, `handleGetHistory`, `handleDeleteHistory`, and `handleClearHistory` stubs.

- [ ] **Step 5: Run tests**

```bash
cd backend
go test ./...
```

Expected: all packages compile.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/store/history.go backend/internal/httpapi/history_handlers.go backend/internal/httpapi/router.go backend/internal/app/app.go
git commit -m "feat: add mysql history endpoints"
```

---

### Task 9: Implement Legacy Import

**Files:**
- Modify: `backend/internal/legacy/import.go`
- Modify: `backend/internal/legacy/import_test.go`

- [ ] **Step 1: Replace `backend/internal/legacy/import.go` with JSON parsing and DB upsert**

```go
package legacy

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type indexFile struct {
	Entries []entry `json:"entries"`
}

type entry struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Format     string `json:"format"`
	FormatName string `json:"formatName"`
	Mode       string `json:"mode"`
	Duration   string `json:"duration"`
	Preview    string `json:"preview"`
	Output     string `json:"output"`
	CreatedAt  string `json:"createdAt"`
}

func Import(ctx context.Context, db *sql.DB, sourceDir string) error {
	userDirs, err := os.ReadDir(sourceDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, userDir := range userDirs {
		if !userDir.IsDir() {
			continue
		}
		username := userDir.Name()
		userID, err := ensureUser(ctx, db, username)
		if err != nil {
			return err
		}
		if err := importConfig(ctx, db, userID, filepath.Join(sourceDir, username, "api-config.json")); err != nil {
			return err
		}
		if err := importHistory(ctx, db, userID, filepath.Join(sourceDir, username, "outputs")); err != nil {
			return err
		}
	}
	return nil
}

func ensureUser(ctx context.Context, db *sql.DB, username string) (int64, error) {
	_, err := db.ExecContext(ctx, `
INSERT INTO users(username, password_hash)
VALUES(?, ?)
ON DUPLICATE KEY UPDATE username = username
`, username, "")
	if err != nil {
		return 0, err
	}
	var userID int64
	err = db.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	return userID, err
}

func importConfig(ctx context.Context, db *sql.DB, userID int64, configPath string) error {
	raw, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var cfg struct {
		Provider string `json:"provider"`
		BaseURL  string `json:"baseUrl"`
		Model    string `json:"model"`
		APIKey   string `json:"apiKey"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
INSERT INTO api_configs(user_id, provider, base_url, model, api_key_ciphertext)
VALUES(?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  provider = VALUES(provider),
  base_url = VALUES(base_url),
  model = VALUES(model),
  api_key_ciphertext = VALUES(api_key_ciphertext)
`, userID, first(cfg.Provider, "openai"), first(cfg.BaseURL, "https://api.openai.com/v1"), first(cfg.Model, "gpt-4o-mini"), cfg.APIKey)
	return err
}

func importHistory(ctx context.Context, db *sql.DB, userID int64, outputsDir string) error {
	raw, err := os.ReadFile(filepath.Join(outputsDir, "index.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var idx indexFile
	if err := json.Unmarshal(raw, &idx); err != nil {
		return err
	}
	for _, item := range idx.Entries {
		output := item.Output
		if output == "" && item.Filename != "" {
			body, err := os.ReadFile(filepath.Join(outputsDir, filepath.Base(item.Filename)))
			if err == nil {
				output = stripHeader(string(body))
			}
		}
		createdAt := time.Now()
		if item.CreatedAt != "" {
			if parsed, err := time.Parse(time.RFC3339, item.CreatedAt); err == nil {
				createdAt = parsed
			}
		}
		_, err := db.ExecContext(ctx, `
INSERT INTO generation_histories(user_id, external_id, mode, format, format_name, duration, preview, output, created_at)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE output = VALUES(output), preview = VALUES(preview)
`, userID, item.ID, first(item.Mode, "continuous"), item.Format, item.FormatName, first(item.Duration, "10s"), first(item.Preview, makePreview(output)), output, createdAt)
		if err != nil {
			return err
		}
	}
	return nil
}

func stripHeader(content string) string {
	separator := "\n" + strings.Repeat("=", 40) + "\n\n"
	parts := strings.SplitN(content, separator, 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return content
}

func makePreview(output string) string {
	clean := strings.ReplaceAll(output, "\n", " ")
	runes := []rune(clean)
	if len(runes) > 40 {
		return string(runes[:40])
	}
	return clean
}

func first(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
```

- [ ] **Step 2: Replace `backend/internal/legacy/import_test.go`**

```go
package legacy

import "testing"

func TestStripHeader(t *testing.T) {
	content := "格式：画布模式\n" + "========================================" + "\n\n正文内容"
	if got := stripHeader(content); got != "正文内容" {
		t.Fatalf("stripHeader() = %q", got)
	}
}

func TestMakePreviewUsesRuneLength(t *testing.T) {
	got := makePreview("一二三四五六七八九十十一十二十三十四十五十六十七十八十九二十")
	if len([]rune(got)) > 40 {
		t.Fatalf("preview too long: %d", len([]rune(got)))
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend
go test ./...
```

Expected: all packages compile and legacy tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/legacy/import.go backend/internal/legacy/import_test.go
git commit -m "feat: import legacy user data into mysql"
```

---

### Task 10: Add Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Create: `backend/README.md`

- [ ] **Step 1: Create `backend/README.md`**

```markdown
# Go Backend

This backend is the first phase of the Go + React + MySQL refactor.

## Local MySQL

Create a database and user:

```sql
CREATE DATABASE qiantie CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'qiantie'@'localhost' IDENTIFIED BY 'qiantie';
GRANT ALL PRIVILEGES ON qiantie.* TO 'qiantie'@'localhost';
FLUSH PRIVILEGES;
```

## Run

```bash
cd backend
export QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local'
go run ./cmd/qiantie
```

Health check:

```bash
curl -s http://127.0.0.1:4000/healthz
```

Expected:

```json
{"ok":true}
```

## Import Legacy Data

```bash
cd backend
export QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local'
go run ./cmd/qiantie migrate-legacy
```
```

- [ ] **Step 2: Modify root `README.md`**

Add:

```markdown
## Go + MySQL Backend Preview

The repository includes a staged Go backend under `backend/`. It is not yet a replacement for the Express server. It provides the MySQL-backed foundation for login, API config, history, and legacy import.

See `backend/README.md` for local commands.
```

- [ ] **Step 3: Run verification commands**

Run:

```bash
cd backend
go test ./...
go build -o qiantie ./cmd/qiantie
./qiantie --help
```

Expected:

- `go test ./...` passes.
- `go build` creates `backend/qiantie`.
- `./qiantie --help` may fail because no help flag is implemented; if it starts the server instead, stop it and replace this check with:

```bash
QIANTIE_MYSQL_DSN='qiantie:qiantie@tcp(127.0.0.1:3306)/qiantie?parseTime=true&charset=utf8mb4&loc=Local' ./qiantie
curl -s http://127.0.0.1:4000/healthz
```

- [ ] **Step 4: Run existing Node validation**

Run from repo root:

```bash
node -c server.js
node scripts/validate-multipage-architecture.js
```

Expected:

```text
Multipage architecture validation passed.
```

- [ ] **Step 5: Commit docs**

```bash
git add README.md backend/README.md
git commit -m "docs: document go backend foundation"
```

---

## Self-Review

- Spec coverage: This plan covers the backend/data foundation, MySQL schema, auth, config, history, and legacy import from the design doc.
- Intentional gaps: React + Antd frontend, AI generation orchestration, TTS proxy, and Express replacement are split into later plans because they are independent subsystems.
- Placeholder scan: The plan uses concrete file paths, commands, schema, and code snippets. Example JSON values are explicit.
- Type consistency: User store, config store, history store, and API dependency names are defined before handler tasks consume them.
