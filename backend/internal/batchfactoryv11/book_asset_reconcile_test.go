package batchfactoryv11

import (
	"context"
	"testing"
)

func TestSplitAssetNameCoreAndNote(t *testing.T) {
	cases := []struct {
		input     string
		wantCore  string
		wantNote  string
	}{
		{"前女友", "前女友", ""},
		{"前女友（林薇）", "前女友", "林薇"},
		{"儿子 (小冰山)", "儿子", "小冰山"},
		{"丈夫（秦衍）（总裁）", "丈夫（秦衍）", "总裁"},
		{"（只有括号）", "（只有括号）", ""},
	}
	for _, tc := range cases {
		core, note := splitAssetName(tc.input)
		if core != tc.wantCore || note != tc.wantNote {
			t.Fatalf("splitAssetName(%q) = (%q,%q), want (%q,%q)", tc.input, core, note, tc.wantCore, tc.wantNote)
		}
	}
}

func TestReconcileDirectorAssetsMatchesRenamedNote(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-old-ex", Kind: "character", Name: "前女友", Source: "director"},
	}
	desired := []BookAsset{
		{Kind: "character", Name: "前女友（林薇）", Prompt: "林薇，29岁"},
	}
	plan := reconcileDirectorAssets(existing, desired, map[string]bool{})
	if len(plan.Updates) != 1 || plan.Updates[0].ID != "asset-old-ex" {
		t.Fatalf("renamed asset must update the old row: %+v", plan)
	}
	if len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("renamed asset must not insert or delete: %+v", plan)
	}
}

func TestReconcileDirectorAssetsDeletesStaleRowsWithoutImages(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-keep", Kind: "character", Name: "林溪", Source: "director"},
		{ID: "asset-stale", Kind: "character", Name: "路人甲", Source: "director"},
	}
	desired := []BookAsset{
		{Kind: "character", Name: "林溪", Prompt: "短发女主"},
	}
	plan := reconcileDirectorAssets(existing, desired, map[string]bool{})
	if len(plan.Updates) != 1 || plan.Updates[0].ID != "asset-keep" {
		t.Fatalf("kept asset missing: %+v", plan)
	}
	if len(plan.Deletes) != 1 || plan.Deletes[0] != "asset-stale" {
		t.Fatalf("stale asset must be deleted: %+v", plan)
	}
}

func TestReconcileDirectorAssetsKeepsStaleRowsWithImages(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-stale-image", Kind: "scene", Name: "旧花园", Source: "director"},
	}
	plan := reconcileDirectorAssets(existing, nil, map[string]bool{"asset-stale-image": true})
	if len(plan.Deletes) != 0 {
		t.Fatalf("stale rows with images must be kept: %+v", plan)
	}
}

func TestReconcileDirectorAssetsKeepsManualRowsUntouched(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-manual", Kind: "character", Name: "前女友", Source: "manual"},
	}
	desired := []BookAsset{
		{Kind: "character", Name: "前女友（林薇）", Prompt: "AI又造的同名人"},
	}
	plan := reconcileDirectorAssets(existing, desired, map[string]bool{})
	if len(plan.Updates) != 0 || len(plan.Inserts) != 0 || len(plan.Deletes) != 0 {
		t.Fatalf("manual row must win and swallow the AI duplicate: %+v", plan)
	}
}

func TestReconcileDirectorAssetsReplacesDifferentNotesWhenNoImages(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-son-a", Kind: "character", Name: "儿子（小冰山）", Source: "director"},
	}
	desired := []BookAsset{
		{Kind: "character", Name: "儿子（小火山）", Prompt: "另一个儿子"},
	}
	plan := reconcileDirectorAssets(existing, desired, map[string]bool{})
	// Two different notes are never merged in place: with no image on the old
	// row it is replaced (delete + insert) so the ledger still holds one row
	// instead of stacking two.
	if len(plan.Inserts) != 1 || plan.Inserts[0].Name != "儿子（小火山）" {
		t.Fatalf("new different-note character must be inserted: %+v", plan)
	}
	if len(plan.Deletes) != 1 || plan.Deletes[0] != "asset-son-a" {
		t.Fatalf("imageless old same-core row must be replaced: %+v", plan)
	}

	// If the old row has a generated/uploaded image, it is protected and both
	// rows coexist as potentially different people.
	planImage := reconcileDirectorAssets(existing, desired, map[string]bool{"asset-son-a": true})
	if len(planImage.Deletes) != 0 || len(planImage.Inserts) != 1 {
		t.Fatalf("image-backed old row must be kept: %+v", planImage)
	}
}

func TestReconcileDirectorAssetsSkipsAmbiguousCoreMatches(t *testing.T) {
	existing := []existingAssetRow{
		{ID: "asset-ex1", Kind: "character", Name: "前女友", Source: "director"},
		{ID: "asset-ex2", Kind: "character", Name: "前女友（某人）", Source: "director"},
	}
	desired := []BookAsset{
		{Kind: "character", Name: "前女友（林薇）", Prompt: "林薇"},
	}
	plan := reconcileDirectorAssets(existing, desired, map[string]bool{})
	// Only the empty-note candidate qualifies, so the match is still unique.
	if len(plan.Updates) != 1 || plan.Updates[0].ID != "asset-ex1" {
		t.Fatalf("empty-note candidate should match uniquely: %+v", plan)
	}

	// Now make it truly ambiguous: two empty-note same-core rows cannot exist
	// by unique key, so instead test desired-side ambiguity.
	plan2 := reconcileDirectorAssets(
		[]existingAssetRow{{ID: "asset-ex1", Kind: "character", Name: "前女友", Source: "director"}},
		[]BookAsset{
			{Kind: "character", Name: "前女友（林薇）", Prompt: "林薇"},
			{Kind: "character", Name: "前女友（某人）", Prompt: "某人"},
		},
		map[string]bool{},
	)
	if len(plan2.Updates) != 0 {
		t.Fatalf("ambiguous desired core must not match in place: %+v", plan2)
	}
	if len(plan2.Inserts) != 2 || len(plan2.Deletes) != 1 {
		t.Fatalf("ambiguous desired rows insert; old imageless row is replaced: %+v", plan2)
	}
}

// End-to-end through the memory store: a second director run that renames one
// character and drops another must not grow the asset ledger.
func TestMemoryDirectorRunsDoNotStackAssets(t *testing.T) {
	store, batch, book := seedDirectorBook(t, "original", false)

	first := []BookAsset{
		{BatchID: batch.ID, BookID: book.ID, Kind: "character", Name: "前女友", Prompt: "旧描述", Source: "director"},
		{BatchID: batch.ID, BookID: book.ID, Kind: "character", Name: "林溪", Prompt: "女主", Source: "director"},
	}
	for _, asset := range first {
		id, err := store.CreateBookAsset(context.Background(), "alice", batch.ID, book.ID, CreateBookAssetInput{Kind: asset.Kind, Name: asset.Name, Prompt: asset.Prompt})
		if err != nil {
			t.Fatal(err)
		}
		_ = id
	}
	// Simulate what a second director run would write: one renamed, one kept.
	reconcile := func(desired []BookAsset) {
		existingRows := []existingAssetRow{}
		for assetID, owned := range store.bookAssets {
			asset := owned.Value
			if owned.Owner == "alice" && asset.BatchID == batch.ID && asset.BookID == book.ID {
				existingRows = append(existingRows, existingAssetRow{ID: assetID, Kind: asset.Kind, Name: asset.Name, Source: asset.Source})
			}
		}
		plan := reconcileDirectorAssets(existingRows, desired, map[string]bool{})
		for _, id := range plan.Deletes {
			delete(store.bookAssets, id)
		}
		for _, update := range plan.Updates {
			asset := store.bookAssets[update.ID].Value
			asset.Prompt = update.Prompt
			store.bookAssets[update.ID] = memoryOwned[BookAsset]{Owner: "alice", Value: asset}
		}
		for _, seed := range plan.Inserts {
			seed.ID = store.id("asset")
			store.bookAssets[seed.ID] = memoryOwned[BookAsset]{Owner: "alice", Value: seed}
		}
	}
	reconcile([]BookAsset{
		{BatchID: batch.ID, BookID: book.ID, Kind: "character", Name: "前女友（林薇）", Prompt: "新描述", Source: "director"},
		{BatchID: batch.ID, BookID: book.ID, Kind: "character", Name: "林溪", Prompt: "女主", Source: "director"},
	})
	count := 0
	for _, owned := range store.bookAssets {
		asset := owned.Value
		if owned.Owner == "alice" && asset.BatchID == batch.ID && asset.BookID == book.ID {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("asset ledger stacked to %d rows, want 2", count)
	}
}
