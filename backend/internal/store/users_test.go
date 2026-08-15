package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"strings"
	"sync"
	"testing"
)

const seedOwnerTestDriverName = "qiantie-seed-owner-test"

var (
	registerSeedOwnerTestDriver sync.Once
	seedOwnerTestState          *seedOwnerDBState
)

type seedOwnerDBState struct {
	markerRows []int64
	queries    []string
}

func TestEnsureBridgeUserSynchronizesOwnerFlag(t *testing.T) {
	state := &bridgeUserDBState{}
	users := newBridgeUserTestUsers(t, state)

	if _, err := users.EnsureBridgeUser(context.Background(), "member", true); err != nil {
		t.Fatalf("EnsureBridgeUser(true) error = %v", err)
	}
	if _, err := users.EnsureBridgeUser(context.Background(), "member", false); err != nil {
		t.Fatalf("EnsureBridgeUser(false) error = %v", err)
	}

	if len(state.ownerValues) != 2 || !state.ownerValues[0] || state.ownerValues[1] {
		t.Fatalf("owner values = %#v, want [true false]", state.ownerValues)
	}
}

func TestEnsureSeedOwnerPromotesLegacySeedExactlyOnce(t *testing.T) {
	state := &seedOwnerDBState{markerRows: []int64{1, 0}}
	users := newSeedOwnerTestUsers(t, state)

	if err := users.EnsureSeedOwner(context.Background(), "legacy-seed", "hash"); err != nil {
		t.Fatalf("first EnsureSeedOwner() error = %v", err)
	}
	if err := users.EnsureSeedOwner(context.Background(), "legacy-seed", "hash"); err != nil {
		t.Fatalf("second EnsureSeedOwner() error = %v", err)
	}

	if got := countSeedOwnerQuery(state.queries, "UPDATE users SET is_owner = TRUE WHERE username = ?"); got != 1 {
		t.Fatalf("owner promotion updates = %d, want 1; queries: %#v", got, state.queries)
	}
	if got := countSeedOwnerQuery(state.queries, "INSERT IGNORE INTO app_initializations(initialization_key) VALUES(?)"); got != 2 {
		t.Fatalf("initialization marker writes = %d, want 2; queries: %#v", got, state.queries)
	}
	for _, query := range state.queries {
		if strings.Contains(query, "UPDATE users") && strings.Contains(strings.ToLower(query), "is_active") {
			t.Fatalf("seed promotion must not reset is_active: %q", query)
		}
	}
}

func newSeedOwnerTestUsers(t *testing.T, state *seedOwnerDBState) *Users {
	t.Helper()
	registerSeedOwnerTestDriver.Do(func() { sql.Register(seedOwnerTestDriverName, seedOwnerTestDriver{}) })
	seedOwnerTestState = state
	db, err := sql.Open(seedOwnerTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewUsers(db)
}

func countSeedOwnerQuery(queries []string, want string) int {
	count := 0
	for _, query := range queries {
		if query == want {
			count++
		}
	}
	return count
}

type seedOwnerTestDriver struct{}

func (seedOwnerTestDriver) Open(string) (driver.Conn, error) {
	return seedOwnerTestConn{}, nil
}

type seedOwnerTestConn struct{}

func (seedOwnerTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (seedOwnerTestConn) Close() error                        { return nil }
func (seedOwnerTestConn) Begin() (driver.Tx, error)           { return seedOwnerTestTx{}, nil }
func (seedOwnerTestConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return seedOwnerTestTx{}, nil
}
func (seedOwnerTestConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	normalized := strings.Join(strings.Fields(query), " ")
	seedOwnerTestState.queries = append(seedOwnerTestState.queries, normalized)
	if strings.HasPrefix(normalized, "INSERT IGNORE INTO app_initializations") {
		rows := seedOwnerTestState.markerRows[0]
		seedOwnerTestState.markerRows = seedOwnerTestState.markerRows[1:]
		return driver.RowsAffected(rows), nil
	}
	return driver.RowsAffected(1), nil
}

type seedOwnerTestTx struct{}

func (seedOwnerTestTx) Commit() error   { return nil }
func (seedOwnerTestTx) Rollback() error { return nil }

const bridgeUserTestDriverName = "qiantie-bridge-user-test"

var registerBridgeUserTestDriver sync.Once

type bridgeUserDBState struct{ ownerValues []bool }
type bridgeUserTestDriver struct{}
type bridgeUserTestConn struct{}

func newBridgeUserTestUsers(t *testing.T, state *bridgeUserDBState) *Users {
	t.Helper()
	registerBridgeUserTestDriver.Do(func() { sql.Register(bridgeUserTestDriverName, bridgeUserTestDriver{}) })
	db, err := sql.Open(bridgeUserTestDriverName, "")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	bridgeUserTestState = state
	return NewUsers(db)
}

var bridgeUserTestState *bridgeUserDBState

func (bridgeUserTestDriver) Open(string) (driver.Conn, error)  { return bridgeUserTestConn{}, nil }
func (bridgeUserTestConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (bridgeUserTestConn) Close() error                        { return nil }
func (bridgeUserTestConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }
func (bridgeUserTestConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "INSERT INTO users(username, password_hash, is_owner, is_active)") {
		bridgeUserTestState.ownerValues = append(bridgeUserTestState.ownerValues, args[1].Value.(bool))
	}
	return driver.RowsAffected(1), nil
}
func (bridgeUserTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if strings.Contains(query, "FROM users") {
		return &bridgeUserTestRows{}, nil
	}
	return nil, driver.ErrSkip
}

type bridgeUserTestRows struct{ returned bool }

func (r *bridgeUserTestRows) Columns() []string {
	return []string{"id", "username", "password_hash", "is_owner", "is_active"}
}
func (r *bridgeUserTestRows) Close() error { return nil }
func (r *bridgeUserTestRows) Next(dest []driver.Value) error {
	if r.returned {
		return io.EOF
	}
	dest[0], dest[1], dest[2], dest[3], dest[4] = int64(1), "member", "bridge-managed-account", false, true
	r.returned = true
	return nil
}
