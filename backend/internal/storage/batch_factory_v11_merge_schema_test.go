package storage

import (
	"strings"
	"testing"
)

func TestV11MergeMigrationAddsDurableMergeJobs(t *testing.T) {
	joined := strings.ToLower(strings.Join(V11MergeStatements(), "\n"))
	for _, table := range []string{
		"batch_factory_v11_merge_jobs",
		"batch_factory_v11_merge_sources",
	} {
		if !strings.Contains(joined, table) {
			t.Fatalf("missing merge table %s", table)
		}
	}
	for _, clause := range []string{
		"unique key uq_bfv11_merge_request",
		"foreign key (batch_id) references batch_factory_v11_batches(id)",
		"foreign key (job_id) references batch_factory_v11_merge_jobs(id)",
	} {
		if !strings.Contains(joined, clause) {
			t.Fatalf("missing merge durability clause %s", clause)
		}
	}
}

func TestV11MigrationsRegisterMergeAfterProduction(t *testing.T) {
	migrations := V11Migrations()
	if len(migrations) < 7 || migrations[len(migrations)-2].Version != 1100006 || migrations[len(migrations)-1].Version != 1100007 {
		t.Fatalf("merge migration missing: %+v", migrations)
	}
	if migrations[len(migrations)-2].CallbackChecksum != "batch-factory-v11-merge-v1" || migrations[len(migrations)-1].CallbackChecksum != "batch-factory-v11-merge-poller-v1" {
		t.Fatalf("unexpected merge checksum: %+v", migrations[len(migrations)-1])
	}
}
