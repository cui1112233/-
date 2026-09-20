package batchfactoryv11

import (
	"fmt"
	"strings"
)

type H3SourceSlice struct {
	SourceIndex      int      `json:"source_index"`
	SourceKey        string   `json:"source_key"`
	SourceTextHash   string   `json:"source_text_hash"`
	CanonicalStartMS int64    `json:"canonical_start_ms"`
	CanonicalEndMS   int64    `json:"canonical_end_ms"`
	SegmentStartMS   int64    `json:"segment_start_ms"`
	SegmentEndMS     int64    `json:"segment_end_ms"`
	MicroShotKeys    []string `json:"micro_shot_keys"`
}

type H3SegmentMicroShot struct {
	SourceIndex         int    `json:"source_index"`
	SourceKey           string `json:"source_key"`
	MicroShotKey        string `json:"micro_shot_key"`
	CanonicalStartMS    int64  `json:"canonical_start_ms"`
	CanonicalEndMS      int64  `json:"canonical_end_ms"`
	CanonicalDurationMS int64  `json:"canonical_duration_ms"`
	SegmentStartMS      int64  `json:"segment_start_ms"`
	SegmentEndMS        int64  `json:"segment_end_ms"`
}

type H3VideoSegment struct {
	SegmentIndex        int                  `json:"segment_index"`
	SegmentKey          string               `json:"segment_key"`
	CanonicalStartMS    int64                `json:"canonical_start_ms"`
	CanonicalEndMS      int64                `json:"canonical_end_ms"`
	CanonicalDurationMS int64                `json:"canonical_duration_ms"`
	SourceSlices        []H3SourceSlice      `json:"source_slices"`
	MicroShots          []H3SegmentMicroShot `json:"micro_shots"`
}

type h3SegmentUnit struct {
	startMS    int64
	endMS      int64
	source     H3SourceSlice
	microShots []H3SegmentMicroShot
}

func SegmentH3CanonicalTimeline(document H3DirectorDocument, timeline H3CanonicalTimeline, maxSegmentMS int64) ([]H3VideoSegment, error) {
	if maxSegmentMS != 10000 && maxSegmentMS != 15000 {
		return nil, fmt.Errorf("%w: max_segment_ms must be 10000 or 15000", ErrInvalid)
	}
	if err := validateH3TimelineForSegmentation(document, timeline); err != nil {
		return nil, err
	}

	units := make([]h3SegmentUnit, 0, len(timeline.Cards))
	for cardIndex, timelineCard := range timeline.Cards {
		directorCard := document.DirectorCards[cardIndex]
		if timelineCard.CanonicalDurationMS <= maxSegmentMS {
			units = append(units, h3UnitForMicroRange(directorCard, timelineCard, 0, len(timelineCard.MicroShots)))
			continue
		}
		start := 0
		var duration int64
		for shotIndex, shot := range timelineCard.MicroShots {
			if shot.CanonicalDurationMS > maxSegmentMS {
				return nil, fmt.Errorf("%w: director_cards[%d].micro_shots[%d] duration %dms exceeds %dms", ErrInvalid, cardIndex, shotIndex, shot.CanonicalDurationMS, maxSegmentMS)
			}
			if duration > 0 && duration+shot.CanonicalDurationMS > maxSegmentMS {
				units = append(units, h3UnitForMicroRange(directorCard, timelineCard, start, shotIndex))
				start = shotIndex
				duration = 0
			}
			duration += shot.CanonicalDurationMS
		}
		units = append(units, h3UnitForMicroRange(directorCard, timelineCard, start, len(timelineCard.MicroShots)))
	}

	segments := make([]H3VideoSegment, 0, len(units))
	var current *H3VideoSegment
	for _, unit := range units {
		unitDuration := unit.endMS - unit.startMS
		if current == nil || current.CanonicalDurationMS+unitDuration > maxSegmentMS {
			segments = append(segments, H3VideoSegment{
				SegmentIndex:     len(segments) + 1,
				SegmentKey:       fmt.Sprintf("SEG%03d", len(segments)+1),
				CanonicalStartMS: unit.startMS,
				SourceSlices:     []H3SourceSlice{},
				MicroShots:       []H3SegmentMicroShot{},
			})
			current = &segments[len(segments)-1]
		}
		segmentOffset := current.CanonicalDurationMS
		source := unit.source
		source.SegmentStartMS = segmentOffset
		source.SegmentEndMS = segmentOffset + unitDuration
		current.SourceSlices = append(current.SourceSlices, source)
		for _, microShot := range unit.microShots {
			microShot.SegmentStartMS = microShot.CanonicalStartMS - current.CanonicalStartMS
			microShot.SegmentEndMS = microShot.CanonicalEndMS - current.CanonicalStartMS
			current.MicroShots = append(current.MicroShots, microShot)
		}
		current.CanonicalEndMS = unit.endMS
		current.CanonicalDurationMS = current.CanonicalEndMS - current.CanonicalStartMS
	}
	return segments, nil
}

func h3UnitForMicroRange(directorCard H3DirectorCard, timelineCard H3CanonicalCard, start, end int) h3SegmentUnit {
	microShots := make([]H3SegmentMicroShot, 0, end-start)
	microKeys := make([]string, 0, end-start)
	for index := start; index < end; index++ {
		shot := timelineCard.MicroShots[index]
		microKeys = append(microKeys, shot.MicroShotKey)
		microShots = append(microShots, H3SegmentMicroShot{
			SourceIndex:         timelineCard.SourceIndex,
			SourceKey:           timelineCard.SourceKey,
			MicroShotKey:        shot.MicroShotKey,
			CanonicalStartMS:    shot.CanonicalStartMS,
			CanonicalEndMS:      shot.CanonicalEndMS,
			CanonicalDurationMS: shot.CanonicalDurationMS,
		})
	}
	startMS := timelineCard.MicroShots[start].CanonicalStartMS
	endMS := timelineCard.MicroShots[end-1].CanonicalEndMS
	return h3SegmentUnit{
		startMS: startMS,
		endMS:   endMS,
		source: H3SourceSlice{
			SourceIndex:      timelineCard.SourceIndex,
			SourceKey:        timelineCard.SourceKey,
			SourceTextHash:   directorCard.SourceTextHash,
			CanonicalStartMS: startMS,
			CanonicalEndMS:   endMS,
			MicroShotKeys:    microKeys,
		},
		microShots: microShots,
	}
}

func validateH3TimelineForSegmentation(document H3DirectorDocument, timeline H3CanonicalTimeline) error {
	if document.SchemaVersion != h3DirectorSchemaV1 || document.Writer != h3DirectorWriterV12 {
		return fmt.Errorf("%w: a validated V12 H3 director document is required", ErrInvalid)
	}
	if err := validateH3DirectorIdentityUniqueness(document); err != nil {
		return err
	}
	if timeline.SchemaVersion != h3CanonicalTimelineSchemaV1 || (timeline.AllocatorVersion != h3TimelineAllocatorV1 && timeline.AllocatorVersion != "h3-per-line-tts/v1") {
		return fmt.Errorf("%w: a supported H3 canonical timeline is required", ErrInvalid)
	}
	if strings.TrimSpace(timeline.DirectorRevisionID) == "" || timeline.AudioDurationMS <= 0 {
		return fmt.Errorf("%w: timeline director revision and audio duration are required", ErrInvalid)
	}
	if len(document.DirectorCards) != len(timeline.Cards) {
		return fmt.Errorf("%w: timeline card count does not match director", ErrInvalid)
	}
	var cursor int64
	for cardIndex, timelineCard := range timeline.Cards {
		directorCard := document.DirectorCards[cardIndex]
		if timelineCard.SourceIndex != directorCard.SourceIndex || timelineCard.SourceKey != directorCard.SourceKey {
			return fmt.Errorf("%w: timeline.cards[%d] source identity does not match director", ErrInvalid, cardIndex)
		}
		if timelineCard.CanonicalStartMS != cursor || timelineCard.CanonicalEndMS-timelineCard.CanonicalStartMS != timelineCard.CanonicalDurationMS || timelineCard.CanonicalDurationMS < 0 {
			return fmt.Errorf("%w: timeline.cards[%d] is not contiguous", ErrInvalid, cardIndex)
		}
		if len(timelineCard.MicroShots) != len(directorCard.MicroShots) || len(timelineCard.MicroShots) == 0 {
			return fmt.Errorf("%w: timeline.cards[%d] micro-shot count does not match director", ErrInvalid, cardIndex)
		}
		microCursor := timelineCard.CanonicalStartMS
		for shotIndex, timelineShot := range timelineCard.MicroShots {
			if timelineShot.MicroShotKey != directorCard.MicroShots[shotIndex].MicroShotKey {
				return fmt.Errorf("%w: timeline.cards[%d].micro_shots[%d] identity does not match director", ErrInvalid, cardIndex, shotIndex)
			}
			if timelineShot.CanonicalStartMS != microCursor || timelineShot.CanonicalEndMS-timelineShot.CanonicalStartMS != timelineShot.CanonicalDurationMS || timelineShot.CanonicalDurationMS < 0 {
				return fmt.Errorf("%w: timeline.cards[%d].micro_shots[%d] is not contiguous", ErrInvalid, cardIndex, shotIndex)
			}
			microCursor = timelineShot.CanonicalEndMS
		}
		if microCursor != timelineCard.CanonicalEndMS {
			return fmt.Errorf("%w: timeline.cards[%d] micro-shots do not cover the card", ErrInvalid, cardIndex)
		}
		cursor = timelineCard.CanonicalEndMS
	}
	if cursor != timeline.AudioDurationMS {
		return fmt.Errorf("%w: timeline duration does not match measured audio", ErrInvalid)
	}
	return nil
}
