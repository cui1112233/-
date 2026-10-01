package batchfactoryv11

import (
	"context"
	"errors"
	"testing"
)

// seedMergeOpeningBook seeds a two-storyboard book whose VIDEO01 carries two
// successful opening variants and whose batch settings enable 换开头.
func seedMergeOpeningBook(t *testing.T) (*MemoryStore, Batch, Book) {
	t.Helper()
	store, batch, book, _ := seedCompiledSDOpening(t, []OpeningVariant{
		{Index: 1, Label: "分镜一 | 换开头1", Prompt: "变体一开场", Status: "success"},
		{Index: 2, Label: "分镜一 | 换开头2", Prompt: "变体二开场", Status: "success"},
	})
	return store, batch, book
}

// createOpeningMergeProduction records the production output for the opening
// book: VIDEO01 has one task per opening variant, VIDEO02 has the main task.
func createOpeningMergeProduction(t *testing.T, store *MemoryStore, batch Batch, book Book, variant1Status ProductionState) {
	t.Helper()
	variant1Media := "https://media.example/url-v1.mp4"
	if variant1Status != ProductionSucceeded {
		variant1Media = ""
	}
	_, err := store.CreateProductionJob(context.Background(), ProductionJob{Owner: "alice", BatchID: batch.ID, BookID: book.ID, RequestID: "production-opening", DirectorRevisionID: book.DirectorRevision.ID, Tasks: []ProductionTask{
		{VideoID: book.Videos[0].ID, OpeningVariantIndex: 0, Status: ProductionSucceeded, Attempt: 1, MediaURL: "https://media.example/url-orig.mp4"},
		{VideoID: book.Videos[0].ID, OpeningVariantIndex: 1, Status: variant1Status, Attempt: 1, MediaURL: variant1Media},
		{VideoID: book.Videos[0].ID, OpeningVariantIndex: 2, Status: ProductionSucceeded, Attempt: 1, MediaURL: "https://media.example/url-v2.mp4"},
		{VideoID: book.Videos[1].ID, OpeningVariantIndex: 0, Status: ProductionSucceeded, Attempt: 1, MediaURL: "https://media.example/url-2.mp4"},
	}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestMergeOpeningVariants(t *testing.T) {
	t.Run("builds one merge job per opening variant with per-variant sources", func(t *testing.T) {
		store, batch, book := seedMergeOpeningBook(t)
		createOpeningMergeProduction(t, store, batch, book, ProductionSucceeded)
		adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
		merge := &MergeService{Store: store, Adapter: adapter, Enabled: true}
		jobs, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-opening", MergeOptions{Speed: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(jobs) != 3 {
			t.Fatalf("jobs=%d, want 3: %+v", len(jobs), jobs)
		}
		for index, job := range jobs {
			if job.OpeningVariantIndex != index {
				t.Fatalf("jobs[%d].OpeningVariantIndex=%d, want %d", index, job.OpeningVariantIndex, index)
			}
		}
		if jobs[0].RequestID != "merge-opening" || jobs[1].RequestID != "merge-opening-v1" || jobs[2].RequestID != "merge-opening-v2" {
			t.Fatalf("request ids: %q %q %q", jobs[0].RequestID, jobs[1].RequestID, jobs[2].RequestID)
		}
		if len(jobs[0].Sources) != 2 || jobs[0].Sources[0].MediaURL != "https://media.example/url-orig.mp4" {
			t.Fatalf("variant 0 sources=%+v", jobs[0].Sources)
		}
		if len(jobs[1].Sources) != 2 || jobs[1].Sources[0].MediaURL != "https://media.example/url-v1.mp4" || jobs[1].Sources[1].MediaURL != jobs[0].Sources[1].MediaURL {
			t.Fatalf("variant 1 sources=%+v variant 0 sources=%+v", jobs[1].Sources, jobs[0].Sources)
		}
		if len(jobs[2].Sources) != 2 || jobs[2].Sources[0].MediaURL != "https://media.example/url-v2.mp4" || jobs[2].Sources[1].MediaURL != jobs[0].Sources[1].MediaURL {
			t.Fatalf("variant 2 sources=%+v variant 0 sources=%+v", jobs[2].Sources, jobs[0].Sources)
		}
	})

	t.Run("same request reuses the existing variant jobs", func(t *testing.T) {
		store, batch, book := seedMergeOpeningBook(t)
		createOpeningMergeProduction(t, store, batch, book, ProductionSucceeded)
		adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
		merge := &MergeService{Store: store, Adapter: adapter, Enabled: true}
		first, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-opening", MergeOptions{Speed: 1})
		if err != nil {
			t.Fatal(err)
		}
		second, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-opening", MergeOptions{Speed: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(first) != 3 || len(second) != 3 {
			t.Fatalf("first=%d second=%d, want 3 each", len(first), len(second))
		}
		for index := range first {
			if first[index].ID == "" || first[index].ID != second[index].ID {
				t.Fatalf("job %d not reused: first=%+v second=%+v", index, first[index], second[index])
			}
		}
		if adapter.calls != 3 {
			t.Fatalf("adapter calls=%d, want 3", adapter.calls)
		}
		stored, err := store.ListMergeJobs(context.Background(), "alice", batch.ID)
		if err != nil || len(stored) != 3 {
			t.Fatalf("stored=%+v err=%v", stored, err)
		}
	})

	t.Run("opening disabled keeps the single-job behavior", func(t *testing.T) {
		store, batch, book := seedMergeOpeningBook(t)
		if _, err := store.SaveSettings(context.Background(), "alice", ScopeRef{Kind: ScopeBatch, BatchID: batch.ID}, SettingsUpdate{Patch: SettingsPatch{"openingEnabled": rawSetting(t, false)}, ExpectedRevision: batch.Revision}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateProductionJob(context.Background(), ProductionJob{Owner: "alice", BatchID: batch.ID, BookID: book.ID, RequestID: "production-opening-off", DirectorRevisionID: book.DirectorRevision.ID, Tasks: []ProductionTask{
			{VideoID: book.Videos[0].ID, Status: ProductionSucceeded, Attempt: 1, MediaURL: "https://media.example/url-orig.mp4"},
			{VideoID: book.Videos[1].ID, Status: ProductionSucceeded, Attempt: 1, MediaURL: "https://media.example/url-2.mp4"},
		}}); err != nil {
			t.Fatal(err)
		}
		adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
		merge := &MergeService{Store: store, Adapter: adapter, Enabled: true}
		jobs, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-opening-off", MergeOptions{Speed: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(jobs) != 1 || jobs[0].OpeningVariantIndex != 0 || jobs[0].RequestID != "merge-opening-off" || len(jobs[0].Sources) != 2 || jobs[0].Sources[0].MediaURL != "https://media.example/url-orig.mp4" {
			t.Fatalf("jobs=%+v", jobs)
		}
	})

	t.Run("unfinished variant media aborts before any job is created", func(t *testing.T) {
		store, batch, book := seedMergeOpeningBook(t)
		createOpeningMergeProduction(t, store, batch, book, ProductionRunning)
		adapter := &recordingMergeAdapter{job: MergeJob{Status: MergeSucceeded, OutputURL: "https://media.example/merged.mp4"}}
		merge := &MergeService{Store: store, Adapter: adapter, Enabled: true}
		if _, err := merge.SubmitBookMerge(context.Background(), "alice", batch.ID, book.ID, "merge-opening-blocked", MergeOptions{Speed: 1}); !errors.Is(err, ErrConflict) {
			t.Fatalf("err=%v, want ErrConflict", err)
		}
		if adapter.calls != 0 {
			t.Fatalf("adapter calls=%d, want 0", adapter.calls)
		}
		stored, err := store.ListMergeJobs(context.Background(), "alice", batch.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(stored) != 0 {
			t.Fatalf("no merge job may be created, stored=%+v", stored)
		}
	})
}
