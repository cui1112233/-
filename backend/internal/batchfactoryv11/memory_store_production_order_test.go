package batchfactoryv11

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreListProductionJobsUsesCreationOrderWhenTimestampsTie(t *testing.T) {
	createdAt := time.Date(2026, 9, 20, 5, 30, 0, 123000000, time.UTC)
	for iteration := 0; iteration < 200; iteration++ {
		store, batch, book, video := seedCompiledVideo(t)
		for _, requestID := range []string{"first", "second"} {
			if _, err := store.CreateProductionJob(context.Background(), ProductionJob{
				Owner:              "alice",
				BatchID:            batch.ID,
				BookID:             book.ID,
				RequestID:          requestID,
				DirectorRevisionID: book.DirectorRevision.ID,
				CreatedAt:          createdAt,
				UpdatedAt:          createdAt,
				Tasks: []ProductionTask{{
					VideoID: video.ID,
					Status:  ProductionSucceeded,
				}},
			}); err != nil {
				t.Fatal(err)
			}
		}

		jobs, err := store.ListProductionJobs(context.Background(), "alice", batch.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(jobs) != 2 || jobs[0].RequestID != "first" || jobs[1].RequestID != "second" {
			t.Fatalf("equal-time jobs lost creation order: %#v", jobs)
		}
	}
}
