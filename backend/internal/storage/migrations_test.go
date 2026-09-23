package storage

import (
	"context"
	"strings"
	"testing"
)

type memoryLedger map[int]string

func (m memoryLedger) RecordedChecksum(_ context.Context, v int) (string, bool, error) {
	s, ok := m[v]
	return s, ok, nil
}
func (m memoryLedger) Record(_ context.Context, v int, checksum string) error {
	m[v] = checksum
	return nil
}

func TestRunMigrationPlanRejectsRecordedChecksumMismatch(t *testing.T) {
	m := Migration{Version: 26, SQL: []string{"CREATE TABLE x (id BIGINT)"}}
	err := RunMigrationPlan(context.Background(), memoryLedger{26: "wrong"}, []Migration{m}, func(context.Context, Migration) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("err=%v", err)
	}
}

func TestV11SeparatePromptMigrationAcceptsVerifiedPublicLedgerChecksum(t *testing.T) {
	const publicLegacyChecksum = "0aa0615fbe3d1ffa5d13faee0acc76ec39c0b1232c687630ade52e9f041ab329"

	var promptSplit Migration
	for _, migration := range V11Migrations() {
		if migration.Version == 1100011 {
			promptSplit = migration
			break
		}
	}
	if promptSplit.Version == 0 {
		t.Fatal("prompt split migration is missing")
	}

	appliedAgain := false
	err := RunMigrationPlan(context.Background(), memoryLedger{1100011: publicLegacyChecksum}, []Migration{promptSplit}, func(context.Context, Migration) error {
		appliedAgain = true
		return nil
	})
	if err != nil {
		t.Fatalf("verified public ledger must remain readable: %v", err)
	}
	if appliedAgain {
		t.Fatal("verified prompt split must not run again")
	}
}

func TestV11BookAssetsMigrationAcceptsVerifiedPublicLedgerChecksum(t *testing.T) {
	const publicLegacyChecksum = "b5e1e45e1ae47240a5d303efe70ad8b29afa21d906b482774d696c8424600624"

	var bookAssets Migration
	for _, migration := range V11Migrations() {
		if migration.Version == 1100012 {
			bookAssets = migration
			break
		}
	}
	if bookAssets.Version == 0 {
		t.Fatal("book-assets migration is missing")
	}

	appliedAgain := false
	err := RunMigrationPlan(context.Background(), memoryLedger{1100012: publicLegacyChecksum}, []Migration{bookAssets}, func(context.Context, Migration) error {
		appliedAgain = true
		return nil
	})
	if err != nil {
		t.Fatalf("verified public ledger must remain readable: %v", err)
	}
	if appliedAgain {
		t.Fatal("verified book-assets migration must not run again")
	}
}

func TestV11FoundationSchemaHasNoTextDefault(t *testing.T) {
	for _, statement := range V11FoundationStatements() {
		upper := strings.ToUpper(statement)
		if strings.Contains(upper, "TEXT NOT NULL DEFAULT") || strings.Contains(upper, "MEDIUMTEXT NOT NULL DEFAULT") {
			t.Fatal(statement)
		}
	}
}

func TestChecksumStableAcrossWhitespace(t *testing.T) {
	a := checksumFor(Migration{Version: 1, SQL: []string{"CREATE  TABLE x ( id BIGINT );"}})
	b := checksumFor(Migration{Version: 1, SQL: []string{"CREATE TABLE x ( id BIGINT );"}})
	if a != b {
		t.Fatalf("%s != %s", a, b)
	}
}

func TestAppMigrationsIncludesV11AndV12Migrations(t *testing.T) {
	migrations := AppMigrations()
	want := append(append(append([]Migration(nil), V11Migrations()...), V12Migrations()...), LocalExecutorMigrations()...)
	if len(migrations) != len(want) {
		t.Fatalf("AppMigrations length=%d, want %d", len(migrations), len(want))
	}
	for i, migration := range migrations {
		if migration.Version != want[i].Version {
			t.Fatalf("migration[%d]=%d, want %d", i, migration.Version, want[i].Version)
		}
	}
}

func TestMergePollerMigrationUsesMySQLCompatibleAddColumnSyntax(t *testing.T) {
	statements := V11MergePollerStatements()
	if len(statements) != 1 {
		t.Fatalf("got %d statements, want 1", len(statements))
	}
	upper := strings.ToUpper(statements[0])
	if strings.Contains(upper, "ADD COLUMN IF NOT EXISTS") {
		t.Fatalf("MySQL compatibility regression: %s", statements[0])
	}
	if !strings.Contains(upper, "ADD COLUMN PROVIDER_TASK_ID") {
		t.Fatalf("provider_task_id migration missing: %s", statements[0])
	}
}
