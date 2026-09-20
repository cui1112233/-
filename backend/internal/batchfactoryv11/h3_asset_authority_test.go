package batchfactoryv11

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
)

func seedH3CharacterAssets(t *testing.T, store *MemoryStore, batchID, bookID string) {
	t.Helper()
	for _, c := range mustH3DirectorFixture(t).CharacterRoster {
		if _, err := store.CreateBookAsset(context.Background(), "alice", batchID, bookID, CreateBookAssetInput{Kind: "character", Name: c.CanonicalName, Prompt: c.Appearance}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestH3AssetSelectionKeepsBindingAfterAssetRename(t *testing.T) {
	d := mustH3DirectorFixture(t)
	d.CharacterRoster[0].AssetID = "stable-person-id"
	segment := H3VideoSegment{SourceSlices: []H3SourceSlice{{SourceIndex: 1, SourceKey: d.DirectorCards[0].SourceKey}}}
	ids := automaticAssetIDsForH3Segment(d, segment, map[string]string{"character\x00新姓名": "stable-person-id"})
	if !slices.Contains(ids, "stable-person-id") {
		t.Fatalf("binding lost after rename: %v", ids)
	}
}

func TestH3DirectorBindsAssetAppearanceInsteadOfModelAppearance(t *testing.T) {
	doc := mustH3DirectorFixture(t)
	assets := []BookAsset{}
	for _, c := range doc.CharacterRoster {
		assets = append(assets, BookAsset{ID: "asset-" + c.SlotID, Kind: "character", Name: c.CanonicalName, Prompt: "资产库编辑后的完整外形", Revision: 4})
	}
	raw, _ := json.Marshal(doc)
	bound, err := bindH3DirectorAssets(raw, assets)
	if err != nil {
		t.Fatal(err)
	}
	var got H3DirectorDocument
	if err := json.Unmarshal(bound, &got); err != nil {
		t.Fatal(err)
	}
	for _, c := range got.CharacterRoster {
		if c.Appearance != "资产库编辑后的完整外形" || c.AssetID != "asset-"+c.SlotID || c.AssetRevision != 4 {
			t.Fatalf("not bound to asset: %+v", c)
		}
	}
}

func TestH3BoundAnalysisUsesCurrentAssetAndRejectsMissing(t *testing.T) {
	doc := mustH3DirectorFixture(t)
	assets := []BookAsset{}
	for i := range doc.CharacterRoster {
		doc.CharacterRoster[i].AssetID = "asset-" + doc.CharacterRoster[i].SlotID
		assets = append(assets, BookAsset{ID: doc.CharacterRoster[i].AssetID, Kind: "character", Name: doc.CharacterRoster[i].CanonicalName, Prompt: "新资产外形", Revision: 7})
	}
	analysis, err := h3AnalysisFromBook(doc, Book{AssetRecords: assets})
	if err != nil {
		t.Fatal(err)
	}
	if analysis.CharacterSettings[doc.CharacterRoster[0].SlotID] != "新资产外形" {
		t.Fatal("stale director appearance used")
	}
	if _, err = h3AnalysisFromBook(doc, Book{}); err == nil {
		t.Fatal("missing asset silently fell back to director appearance")
	}
}
