package batchfactoryv11

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestAllocateH3CanonicalTimelineUsesMeasuredAudioMilliseconds(t *testing.T) {
	document := mustH3DirectorFixture(t)
	audio := H3AudioMeasurement{
		AssetID:             "audio-acceptance001",
		ContentHash:         "sha256:audio-acceptance001",
		DurationMS:          7420,
		VideoSourceRevision: document.VideoSourceRevision,
		VideoSourceHash:     document.VideoSourceHash,
	}

	timeline, err := AllocateH3CanonicalTimeline("director-r1", document, audio)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.SchemaVersion != "h3-canonical-timeline/v1" || timeline.AllocatorVersion != "h3-ms-weighted/v1" {
		t.Fatalf("unexpected timeline contract: %#v", timeline)
	}
	if timeline.AudioDurationMS != 7420 || len(timeline.Cards) != 3 {
		t.Fatalf("duration/cards = %d/%d", timeline.AudioDurationMS, len(timeline.Cards))
	}
	wantCardDurations := []int64{2782, 1855, 2783}
	wantMicroDurations := [][]int64{{927, 1855}, {1855}, {927, 1856}}
	var cursor int64
	for cardIndex, card := range timeline.Cards {
		if card.CanonicalStartMS != cursor || card.CanonicalDurationMS != wantCardDurations[cardIndex] {
			t.Fatalf("card %d = %#v, cursor=%d duration=%d", cardIndex, card, cursor, wantCardDurations[cardIndex])
		}
		if card.CanonicalEndMS-card.CanonicalStartMS != card.CanonicalDurationMS {
			t.Fatalf("card %d interval mismatch: %#v", cardIndex, card)
		}
		var microCursor = card.CanonicalStartMS
		for shotIndex, shot := range card.MicroShots {
			if shot.CanonicalStartMS != microCursor || shot.CanonicalDurationMS != wantMicroDurations[cardIndex][shotIndex] {
				t.Fatalf("card %d micro %d = %#v", cardIndex, shotIndex, shot)
			}
			microCursor = shot.CanonicalEndMS
		}
		if microCursor != card.CanonicalEndMS {
			t.Fatalf("card %d micro timeline ends at %d, want %d", cardIndex, microCursor, card.CanonicalEndMS)
		}
		cursor = card.CanonicalEndMS
	}
	if cursor != audio.DurationMS {
		t.Fatalf("timeline ends at %d, want measured audio %d", cursor, audio.DurationMS)
	}

	again, err := AllocateH3CanonicalTimeline("director-r1", document, audio)
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, _ := json.Marshal(timeline)
	secondJSON, _ := json.Marshal(again)
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("allocation is not byte-stable:\n%s\n%s", firstJSON, secondJSON)
	}
}

func TestAllocateH3CanonicalTimelineRejectsUnverifiedAudio(t *testing.T) {
	document := mustH3DirectorFixture(t)
	valid := H3AudioMeasurement{
		AssetID:             "audio-1",
		ContentHash:         "sha256:audio-1",
		DurationMS:          7420,
		VideoSourceRevision: document.VideoSourceRevision,
		VideoSourceHash:     document.VideoSourceHash,
	}
	tests := []struct {
		name   string
		mutate func(*H3AudioMeasurement)
		want   string
	}{
		{name: "missing asset", mutate: func(value *H3AudioMeasurement) { value.AssetID = "" }, want: "audio asset_id is required"},
		{name: "missing hash", mutate: func(value *H3AudioMeasurement) { value.ContentHash = "" }, want: "audio content_hash is required"},
		{name: "zero duration", mutate: func(value *H3AudioMeasurement) { value.DurationMS = 0 }, want: "audio duration_ms must be greater than zero"},
		{name: "source revision mismatch", mutate: func(value *H3AudioMeasurement) { value.VideoSourceRevision = "other" }, want: "audio video_source_revision does not match director"},
		{name: "source hash mismatch", mutate: func(value *H3AudioMeasurement) { value.VideoSourceHash = "other" }, want: "audio video_source_hash does not match director"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := valid
			tt.mutate(&input)
			_, err := AllocateH3CanonicalTimeline("director-r1", document, input)
			if err == nil || !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err=%v, want invalid containing %q", err, tt.want)
			}
		})
	}
}

func TestAllocateH3CanonicalTimelineMaintainsExactCoverageAcrossWeights(t *testing.T) {
	for sample := int64(1); sample <= 75; sample++ {
		document := mustH3DirectorFixture(t)
		for cardIndex := range document.DirectorCards {
			document.DirectorCards[cardIndex].DurationWeight = H3SemanticNumber((sample+int64(cardIndex*3))%11 + 1)
			for shotIndex := range document.DirectorCards[cardIndex].MicroShots {
				document.DirectorCards[cardIndex].MicroShots[shotIndex].Weight = H3SemanticNumber((sample+int64(cardIndex*5+shotIndex*7))%13 + 1)
			}
		}
		duration := int64(1000) + sample*997
		timeline := mustH3Timeline(t, document, duration)
		var cardCursor int64
		for cardIndex, card := range timeline.Cards {
			if card.CanonicalStartMS != cardCursor || card.CanonicalEndMS < card.CanonicalStartMS {
				t.Fatalf("sample %d card %d not ordered: %#v", sample, cardIndex, card)
			}
			var shotCursor = card.CanonicalStartMS
			for shotIndex, shot := range card.MicroShots {
				if shot.CanonicalStartMS != shotCursor || shot.CanonicalEndMS < shot.CanonicalStartMS {
					t.Fatalf("sample %d card %d shot %d not ordered: %#v", sample, cardIndex, shotIndex, shot)
				}
				shotCursor = shot.CanonicalEndMS
			}
			if shotCursor != card.CanonicalEndMS {
				t.Fatalf("sample %d card %d micro-shots end at %d, want %d", sample, cardIndex, shotCursor, card.CanonicalEndMS)
			}
			cardCursor = card.CanonicalEndMS
		}
		if cardCursor != duration {
			t.Fatalf("sample %d timeline ends at %d, want %d", sample, cardCursor, duration)
		}
	}
}

func mustH3DirectorFixture(t *testing.T) H3DirectorDocument {
	t.Helper()
	raw, err := os.ReadFile("testdata/h3_v12_complete_director_trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var sourceEnvelope struct {
		VideoSourceRevision string `json:"video_source_revision"`
		VideoSourceHash     string `json:"video_source_hash"`
		DirectorCards       []struct {
			SourceText string `json:"source_text"`
		} `json:"director_cards"`
	}
	if err := json.Unmarshal(raw, &sourceEnvelope); err != nil {
		t.Fatal(err)
	}
	sourceText := ""
	for index, card := range sourceEnvelope.DirectorCards {
		if index > 0 {
			sourceText += "\n"
		}
		sourceText += card.SourceText
	}
	document, err := ParseH3DirectorDocument(raw, H3VideoSource{
		Revision: sourceEnvelope.VideoSourceRevision,
		Hash:     sourceEnvelope.VideoSourceHash,
		Text:     sourceText,
	})
	if err != nil {
		t.Fatal(err)
	}
	return document
}
