package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
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
