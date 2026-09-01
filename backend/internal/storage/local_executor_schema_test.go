package storage

import (
	"strings"
	"testing"
)

func TestAppMigrationsKeepExistingV11Checksums(t *testing.T) {
	before := V11Migrations()
	all := AppMigrations()
	if len(all) <= len(before) {
		t.Fatal("local executor migration missing")
	}
	for i := range before {
		if ChecksumFor(before[i]) != ChecksumFor(all[i]) {
			t.Fatalf("v11 migration %d checksum changed", before[i].Version)
		}
	}
}

func TestLocalExecutorSchemaStoresHashesNotPlaintextColumns(t *testing.T) {
	migrations := LocalExecutorMigrations()
	if len(migrations) != 1 || migrations[0].Version != 7801001 {
		t.Fatalf("migrations=%+v", migrations)
	}
	sqlText := strings.ToLower(strings.Join(migrations[0].SQL, "\n"))
	if !strings.Contains(sqlText, "code_hash binary(32)") {
		t.Fatal("missing pairing hash")
	}
	if !strings.Contains(sqlText, "token_hash binary(32)") {
		t.Fatal("missing token hash")
	}
	if strings.Contains(sqlText, "pairing_code ") || strings.Contains(sqlText, "executor_token ") {
		t.Fatal("plaintext secret column present")
	}
}
