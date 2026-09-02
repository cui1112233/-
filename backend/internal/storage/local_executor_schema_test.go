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
	if len(migrations) < 1 || migrations[0].Version != 7801001 {
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

func TestLocalExecutorJobMigrationPreservesAcceptanceAndLeaseIdentity(t *testing.T) {
	migrations := LocalExecutorMigrations()
	if len(migrations) < 2 || migrations[1].Version != 7801002 {
		t.Fatalf("migrations=%+v", migrations)
	}
	sqlText := strings.ToLower(strings.Join(migrations[1].SQL, "\n"))
	for _, required := range []string{
		"local_executor_jobs", "lease_token_hash binary(32)", "lease_generation bigint",
		"accepted_at datetime(6)", "accepted_account_id", "submission_id",
		"local_executor_job_events", "local_executor_artifacts",
	} {
		if !strings.Contains(sqlText, required) {
			t.Fatalf("missing %q", required)
		}
	}
	if strings.Contains(sqlText, "lease_token varchar") {
		t.Fatal("plaintext lease token column present")
	}
}

func TestBodySyncMigrationPersistsRevisionLeaseAndAck(t *testing.T) {
	migrations := LocalExecutorMigrations()
	if len(migrations) != 3 || migrations[2].Version != 7801003 {
		t.Fatalf("migrations=%+v", migrations)
	}
	sqlText := strings.ToLower(strings.Join(migrations[2].SQL, "\n"))
	for _, required := range []string{
		"local_executor_body_syncs",
		"owner_username varchar(191)",
		"book_id varchar(191)",
		"version_id varchar(64)",
		"body_revision bigint unsigned",
		"content_hash char(64)",
		"lease_executor_id varchar(64)",
		"lease_token_hash binary(32)",
		"lease_generation bigint",
		"lease_expires_at datetime(6)",
		"acked_at datetime(6)",
		"unique key uq_local_executor_body_sync_revision",
	} {
		if !strings.Contains(sqlText, required) {
			t.Fatalf("missing %q", required)
		}
	}
	if strings.Contains(sqlText, "lease_token varchar") {
		t.Fatal("plaintext body sync lease token column present")
	}
}
