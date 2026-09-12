package storage

import (
	"strings"
	"testing"
)

func TestV11MergeHierarchyMigrationPersistsBookVideoShotAndTimingIdentity(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11MergeHierarchyStatements(), "\n"))
	for _, required := range []string{
		"alter table batch_factory_v11_merge_jobs",
		"root_request_id varchar(128) null",
		"book_id varchar(64) null",
		"video_id varchar(64) null",
		"stage varchar(32) null",
		"timing_mode varchar(32) null",
		"speed double null",
		"tts_speed double null",
		"audio_duration_seconds double null",
		"idx_bfv11_merge_jobs_hierarchy",
		"alter table batch_factory_v11_merge_sources",
		"production_job_id varchar(64) null",
		"book_id varchar(64) null",
		"shot_id varchar(128) null",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("merge hierarchy migration missing %q: %s", required, joined)
		}
	}
}

func TestV11MergeHierarchyMigrationIsNextV11Version(t *testing.T) {
	migrations := V11MergeHierarchyMigrations()
	if len(migrations) != 1 || migrations[0].Version != 1100012 {
		t.Fatalf("unexpected merge hierarchy migration: %+v", migrations)
	}
}

func TestAppMigrationsRegistersMergeHierarchyBeforeLocalExecutor(t *testing.T) {
	migrations := AppMigrations()
	mergeIndex := -1
	localIndex := -1
	for index, migration := range migrations {
		switch migration.Version {
		case 1100012:
			mergeIndex = index
		case 7801001:
			if localIndex == -1 {
				localIndex = index
			}
		}
	}
	if mergeIndex == -1 {
		t.Fatal("AppMigrations missing V11 merge hierarchy migration 1100012")
	}
	if localIndex == -1 || mergeIndex >= localIndex {
		t.Fatalf("merge hierarchy migration must be registered before local executor migrations: merge=%d local=%d", mergeIndex, localIndex)
	}
}
