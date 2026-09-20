package batchfactoryv11

import (
	"errors"
	"strings"
	"testing"
)

func TestSegmentH3CanonicalTimelinePreservesCardsAndSourceSlices(t *testing.T) {
	document := mustH3DirectorFixture(t)
	document.DirectorCards[0].DurationWeight = 2
	document.DirectorCards[1].DurationWeight = 1
	document.DirectorCards[2].DurationWeight = 1
	timeline := mustH3Timeline(t, document, 30000)

	segments, err := SegmentH3CanonicalTimeline(document, timeline, 15000)
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 2 {
		t.Fatalf("segments=%d, want 2: %#v", len(segments), segments)
	}
	if segments[0].CanonicalStartMS != 0 || segments[0].CanonicalEndMS != 15000 || len(segments[0].SourceSlices) != 1 {
		t.Fatalf("first card was not preserved as one atomic segment: %#v", segments[0])
	}
	if segments[1].CanonicalStartMS != 15000 || segments[1].CanonicalEndMS != 30000 || len(segments[1].SourceSlices) != 2 {
		t.Fatalf("adjacent atomic cards were not greedily packed: %#v", segments[1])
	}
	assertH3SegmentCoverage(t, timeline, segments)
}

func TestSegmentH3CanonicalTimelineSplitsOnlyAtMicroShotBoundaries(t *testing.T) {
	document := mustH3DirectorFixture(t)
	document.DirectorCards[0].DurationWeight = 2
	document.DirectorCards[1].DurationWeight = 1
	document.DirectorCards[2].DurationWeight = 1
	timeline := mustH3Timeline(t, document, 30000)

	segments, err := SegmentH3CanonicalTimeline(document, timeline, 10000)
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 4 {
		t.Fatalf("segments=%d, want 4: %#v", len(segments), segments)
	}
	wantIntervals := [][2]int64{{0, 5000}, {5000, 15000}, {15000, 22500}, {22500, 30000}}
	for index, want := range wantIntervals {
		segment := segments[index]
		if segment.CanonicalStartMS != want[0] || segment.CanonicalEndMS != want[1] || segment.CanonicalDurationMS > 10000 {
			t.Fatalf("segment %d = %#v, want interval %v", index, segment, want)
		}
	}
	if got := segments[0].MicroShots[0].MicroShotKey; got != document.DirectorCards[0].MicroShots[0].MicroShotKey {
		t.Fatalf("first split did not retain micro-shot identity: %q", got)
	}
	if got := segments[1].MicroShots[0].MicroShotKey; got != document.DirectorCards[0].MicroShots[1].MicroShotKey {
		t.Fatalf("second split did not retain micro-shot identity: %q", got)
	}
	assertH3SegmentCoverage(t, timeline, segments)
}

func TestSegmentH3CanonicalTimelineRejectsSingleOversizeMicroShot(t *testing.T) {
	document := mustH3DirectorFixture(t)
	document.DirectorCards[0].DurationWeight = 2
	document.DirectorCards[1].DurationWeight = 1
	document.DirectorCards[2].DurationWeight = 1
	document.DirectorCards[0].MicroShots[0].Weight = 1
	document.DirectorCards[0].MicroShots[1].Weight = 4
	timeline := mustH3Timeline(t, document, 30000)

	_, err := SegmentH3CanonicalTimeline(document, timeline, 10000)
	if err == nil || !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "director_cards[0].micro_shots[1] duration 12000ms exceeds 10000ms") {
		t.Fatalf("err=%v", err)
	}
}

func TestSegmentH3CanonicalTimelineAcceptsOnlyTenOrFifteenSeconds(t *testing.T) {
	document := mustH3DirectorFixture(t)
	timeline := mustH3Timeline(t, document, 7420)
	_, err := SegmentH3CanonicalTimeline(document, timeline, 12000)
	if err == nil || !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "max_segment_ms must be 10000 or 15000") {
		t.Fatalf("err=%v", err)
	}
}

func mustH3Timeline(t *testing.T, document H3DirectorDocument, durationMS int64) H3CanonicalTimeline {
	t.Helper()
	timeline, err := AllocateH3CanonicalTimeline("director-r1", document, H3AudioMeasurement{
		AssetID:             "audio-1",
		ContentHash:         "sha256:audio-1",
		DurationMS:          durationMS,
		VideoSourceRevision: document.VideoSourceRevision,
		VideoSourceHash:     document.VideoSourceHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	return timeline
}

func assertH3SegmentCoverage(t *testing.T, timeline H3CanonicalTimeline, segments []H3VideoSegment) {
	t.Helper()
	var cursor int64
	var slices int
	for index, segment := range segments {
		if segment.SegmentIndex != index+1 || segment.CanonicalStartMS != cursor {
			t.Fatalf("segment %d breaks order/continuity: %#v", index, segment)
		}
		if segment.CanonicalEndMS-segment.CanonicalStartMS != segment.CanonicalDurationMS {
			t.Fatalf("segment %d duration mismatch: %#v", index, segment)
		}
		var segmentCursor int64
		for _, slice := range segment.SourceSlices {
			if slice.SegmentStartMS != segmentCursor || slice.SegmentEndMS-slice.SegmentStartMS != slice.CanonicalEndMS-slice.CanonicalStartMS {
				t.Fatalf("segment %d source slice gap/mismatch: %#v", index, slice)
			}
			segmentCursor = slice.SegmentEndMS
			slices++
		}
		if segmentCursor != segment.CanonicalDurationMS {
			t.Fatalf("segment %d source slices end at %d, want %d", index, segmentCursor, segment.CanonicalDurationMS)
		}
		cursor = segment.CanonicalEndMS
	}
	if cursor != timeline.AudioDurationMS {
		t.Fatalf("segments end at %d, want %d", cursor, timeline.AudioDurationMS)
	}
	if slices < len(timeline.Cards) {
		t.Fatalf("source slice count=%d, want at least %d", slices, len(timeline.Cards))
	}
}
