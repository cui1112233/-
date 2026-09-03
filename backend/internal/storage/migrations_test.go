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
