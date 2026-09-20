package batchfactoryv11

import (
	"encoding/json"
	"testing"
)

func TestH3TimelineUsesMeasuredLinesNotDirectorWeights(t *testing.T) {
	d := mustH3DirectorFixture(t)
	base := H3AudioMeasurement{AssetID: "lines", ContentHash: "measured", DurationMS: 6696, VideoSourceRevision: d.VideoSourceRevision, VideoSourceHash: d.VideoSourceHash}
	raw, _ := json.Marshal(base)
	var payload map[string]any
	json.Unmarshal(raw, &payload)
	payload["method"] = "per_line_tts_probe"
	lines := []any{}
	for i, duration := range []int{3240, 1680, 1776} {
		lines = append(lines, map[string]any{"source_key": d.DirectorCards[i].SourceKey, "source_text_hash": d.DirectorCards[i].SourceTextHash, "duration_ms": duration, "content_hash": "audio"})
		d.DirectorCards[i].DurationWeight = 999
	}
	payload["lines"] = lines
	raw, _ = json.Marshal(payload)
	var measured H3AudioMeasurement
	if err := json.Unmarshal(raw, &measured); err != nil {
		t.Fatal(err)
	}
	timeline, err := AllocateH3CanonicalTimeline("director", d, measured)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []int64{3240, 1680, 1776} {
		if timeline.Cards[i].CanonicalDurationMS != want {
			t.Fatalf("line %d: want measured %d got %d", i, want, timeline.Cards[i].CanonicalDurationMS)
		}
	}
	if _, err := CompileH3VideoSegments(completeH3CompileInput(d, timeline)); err != nil {
		t.Fatalf("measured-line timeline cannot reach VIDEO compilation: %v", err)
	}
	for name, mutate := range map[string]func(*H3AudioMeasurement){
		"missing line":  func(a *H3AudioMeasurement) { a.Lines = a.Lines[:2] },
		"stale text":    func(a *H3AudioMeasurement) { a.Lines[0].SourceTextHash = "stale" },
		"zero duration": func(a *H3AudioMeasurement) { a.Lines[0].DurationMS = 0 },
		"wrong total":   func(a *H3AudioMeasurement) { a.DurationMS++ },
		"wrong order":   func(a *H3AudioMeasurement) { a.Lines[0], a.Lines[1] = a.Lines[1], a.Lines[0] },
	} {
		t.Run(name, func(t *testing.T) {
			bad := measured
			bad.Lines = append([]H3LineAudioMeasurement(nil), measured.Lines...)
			mutate(&bad)
			if _, err := AllocateH3CanonicalTimeline("director", d, bad); err == nil {
				t.Fatal("invalid measurements silently fell back to weights")
			}
		})
	}
}
