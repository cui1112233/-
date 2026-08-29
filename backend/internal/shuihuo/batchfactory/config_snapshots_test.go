package batchfactory

import (
	"reflect"
	"testing"
)

func configSnapshotFixture() []PresetVersion {
	return []PresetVersion{
		{ID: "director", Module: "batch-factory", Name: "导演", Version: 1, Status: "archived", Body: "director-v1", PublishedAt: "2026-08-20T00:00:00.000Z"},
		{ID: "assets", Module: "batch-factory", Name: "资产", Version: 1, Status: "archived", Body: "assets-v1", PublishedAt: "2026-08-20T00:01:00.000Z"},
		{ID: "director", Module: "batch-factory", Name: "导演", Version: 2, Status: "published", Body: "director-v2", PublishedAt: "2026-08-21T00:00:00.000Z"},
		{ID: "assets", Module: "batch-factory", Name: "资产", Version: 2, Status: "published", Body: "assets-v2", PublishedAt: "2026-08-22T00:00:00.000Z"},
	}
}

func TestResolveConfigSnapshotsReplaysCompletePublishedStates(t *testing.T) {
	catalog := ResolveConfigSnapshots(configSnapshotFixture())
	if len(catalog.Versions) != 3 {
		t.Fatalf("versions = %#v", catalog.Versions)
	}
	expected := []map[string]int{
		{"assets": 1, "director": 1},
		{"assets": 1, "director": 2},
		{"assets": 2, "director": 2},
	}
	for index, pins := range expected {
		if !reflect.DeepEqual(catalog.Versions[index].PresetVersions, pins) {
			t.Fatalf("snapshot %d pins = %#v", index, catalog.Versions[index].PresetVersions)
		}
		if catalog.Versions[index].Label != "配置 v"+string(rune('1'+index)) {
			t.Fatalf("snapshot %d label = %q", index, catalog.Versions[index].Label)
		}
		if len(catalog.Versions[index].Revision) != 12 {
			t.Fatalf("snapshot %d revision = %q", index, catalog.Versions[index].Revision)
		}
	}
	if catalog.Latest == nil {
		t.Fatal("latest snapshot is nil")
	}
	if !reflect.DeepEqual(catalog.Latest.PresetVersions, expected[2]) {
		t.Fatalf("latest pins = %#v", catalog.Latest.PresetVersions)
	}
	if catalog.Latest.Revision != catalog.Versions[2].Revision {
		t.Fatalf("latest revision = %q, last = %q", catalog.Latest.Revision, catalog.Versions[2].Revision)
	}
}

func TestResolveConfigSnapshotsIgnoresUnrelatedAndInvalidRows(t *testing.T) {
	rows := append(configSnapshotFixture(),
		PresetVersion{ID: "other", Module: "script", Version: 1, Status: "published", Body: "wrong-module", PublishedAt: "2026-08-23T00:00:00.000Z"},
		PresetVersion{ID: "director", Module: "batch-factory", Version: 3, Status: "draft", Body: "draft", PublishedAt: ""},
		PresetVersion{ID: "assets", Module: "batch-factory", Version: 3, Status: "archived", Body: "invalid-time", PublishedAt: "not-a-time"},
	)
	catalog := ResolveConfigSnapshots(rows)
	if len(catalog.Versions) != 3 {
		t.Fatalf("versions = %#v", catalog.Versions)
	}
}

func TestResolveVersionedPresetUsesPinnedHistoricalThenPublishedFallback(t *testing.T) {
	rows := append(configSnapshotFixture(),
		PresetVersion{ID: "director", Module: "script", Name: "错模块", Version: 3, Status: "published", Body: "wrong-module", PublishedAt: "2026-08-23T00:00:00.000Z"},
		PresetVersion{ID: "blank", Module: "batch-factory", Name: "空", Version: 1, Status: "published", Body: "   ", PublishedAt: "2026-08-23T00:00:00.000Z"},
	)

	pinned, ok := ResolveVersionedPreset(rows, "director", 1)
	if !ok || pinned.Version != 1 || pinned.Body != "director-v1" || pinned.Status != "archived" {
		t.Fatalf("pinned = %#v, ok=%v", pinned, ok)
	}

	latest, ok := ResolveVersionedPreset(rows, "director", 0)
	if !ok || latest.Version != 2 || latest.Body != "director-v2" || latest.Status != "published" {
		t.Fatalf("latest = %#v, ok=%v", latest, ok)
	}

	missingVersionFallback, ok := ResolveVersionedPreset(rows, "director", 99)
	if !ok || missingVersionFallback.Version != 2 {
		t.Fatalf("missing version fallback = %#v, ok=%v", missingVersionFallback, ok)
	}

	if _, ok := ResolveVersionedPreset(rows, "blank", 0); ok {
		t.Fatal("blank body must not resolve")
	}
	if _, ok := ResolveVersionedPreset(rows, "other", 0); ok {
		t.Fatal("wrong module must not resolve")
	}
}
