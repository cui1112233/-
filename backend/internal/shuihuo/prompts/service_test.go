package prompts

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type testRepo struct {
	base   Preset
	addons []Preset
}

func (r testRepo) ResolveEnabled(context.Context, string, Selection) (Preset, []Preset, error) {
	return r.base, r.addons, nil
}

func TestPublicPresetDoesNotExposeBody(t *testing.T) {
	preset := Preset{ID: 1, VersionID: 2, Module: "shuihuo-production", Name: "分段", Body: "SERVER ONLY {{novel_text}}"}
	body, err := json.Marshal(ToPublicPreset(preset))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "SERVER ONLY") {
		t.Fatalf("body leaked: %s", body)
	}
}

func TestAssembleReplacesOnlyKnownVariables(t *testing.T) {
	service := NewService(testRepo{base: Preset{ID: 1, VersionID: 3, Enabled: true, Body: "{{novel_text}} {{segment_text}} {{project_note}} {{secret}}"}}, "shuihuo-production")
	got, err := service.Assemble(context.Background(), Selection{BaseID: 1}, AssembleInput{NovelText: "小说", SegmentText: "分段", ProjectNote: "备注"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Rendered != "小说 分段 备注 {{secret}}" {
		t.Fatalf("rendered = %q", got.Rendered)
	}
}

func TestPromptSnapshotRecordsRenderedTextWithoutPublicLeak(t *testing.T) {
	service := NewService(testRepo{base: Preset{ID: 10, VersionID: 20, Enabled: true, Body: "仅服务端预设：{{novel_text}}"}}, "shuihuo-production")
	snapshot, err := service.Assemble(context.Background(), Selection{BaseID: 10}, AssembleInput{NovelText: "原文"})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.BaseVersionID != 20 || snapshot.Rendered == "" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	public, err := json.Marshal(snapshot.Public())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(public), "仅服务端预设") || strings.Contains(string(public), "原文") {
		t.Fatalf("prompt body leaked: %s", public)
	}
}
