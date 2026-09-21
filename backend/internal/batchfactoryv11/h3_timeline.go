package batchfactoryv11

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const (
	h3CanonicalTimelineSchemaV1 = "h3-canonical-timeline/v1"
	h3TimelineAllocatorV1       = "h3-ms-weighted/v1"
)

// H3AudioMeasurement is the verified TTS fact used to allocate a timeline.
// The source revision/hash bind the audio to the processed video source rather
// than to mutable full-novel text.
type H3AudioMeasurement struct {
	Method              string                   `json:"method,omitempty"`
	TTSFingerprint      string                   `json:"tts_fingerprint,omitempty"`
	Lines               []H3LineAudioMeasurement `json:"lines,omitempty"`
	AssetID             string                   `json:"asset_id"`
	ContentHash         string                   `json:"content_hash"`
	DurationMS          int64                    `json:"duration_ms"`
	VideoSourceRevision string                   `json:"video_source_revision"`
	VideoSourceHash     string                   `json:"video_source_hash"`
}

type H3LineAudioMeasurement struct {
	SourceKey      string `json:"source_key"`
	SourceTextHash string `json:"source_text_hash"`
	ContentHash    string `json:"content_hash"`
	DurationMS     int64  `json:"duration_ms"`
}

type H3CanonicalMicroShot struct {
	MicroShotKey        string `json:"micro_shot_key"`
	CanonicalStartMS    int64  `json:"canonical_start_ms"`
	CanonicalEndMS      int64  `json:"canonical_end_ms"`
	CanonicalDurationMS int64  `json:"canonical_duration_ms"`
}

type H3CanonicalCard struct {
	SourceIndex         int                    `json:"source_index"`
	SourceKey           string                 `json:"source_key"`
	CanonicalStartMS    int64                  `json:"canonical_start_ms"`
	CanonicalEndMS      int64                  `json:"canonical_end_ms"`
	CanonicalDurationMS int64                  `json:"canonical_duration_ms"`
	MicroShots          []H3CanonicalMicroShot `json:"micro_shots"`
}

type H3CanonicalTimeline struct {
	AudioMeasurement   *H3AudioMeasurement `json:"audio_measurement,omitempty"`
	SchemaVersion      string              `json:"schema_version"`
	DirectorRevisionID string              `json:"director_revision_id"`
	AudioAssetID       string              `json:"audio_asset_id"`
	AudioContentHash   string              `json:"audio_content_hash"`
	AudioDurationMS    int64               `json:"audio_duration_ms"`
	AllocatorVersion   string              `json:"allocator_version"`
	InputHash          string              `json:"input_hash"`
	Cards              []H3CanonicalCard   `json:"cards"`
}

func AllocateH3CanonicalTimeline(directorRevisionID string, document H3DirectorDocument, audio H3AudioMeasurement) (H3CanonicalTimeline, error) {
	var timeline H3CanonicalTimeline
	if strings.TrimSpace(directorRevisionID) == "" {
		return timeline, fmt.Errorf("%w: director_revision_id is required", ErrInvalid)
	}
	if document.SchemaVersion != h3DirectorSchemaV1 || document.Writer != h3DirectorWriterV12 {
		return timeline, fmt.Errorf("%w: a validated V12 H3 director document is required", ErrInvalid)
	}
	if len(document.DirectorCards) == 0 {
		return timeline, fmt.Errorf("%w: director_cards must not be empty", ErrInvalid)
	}
	if strings.TrimSpace(audio.AssetID) == "" {
		return timeline, fmt.Errorf("%w: audio asset_id is required", ErrInvalid)
	}
	if strings.TrimSpace(audio.ContentHash) == "" {
		return timeline, fmt.Errorf("%w: audio content_hash is required", ErrInvalid)
	}
	if audio.DurationMS <= 0 {
		return timeline, fmt.Errorf("%w: audio duration_ms must be greater than zero", ErrInvalid)
	}
	if audio.VideoSourceRevision != document.VideoSourceRevision {
		return timeline, fmt.Errorf("%w: audio video_source_revision does not match director", ErrInvalid)
	}
	if audio.VideoSourceHash != document.VideoSourceHash {
		return timeline, fmt.Errorf("%w: audio video_source_hash does not match director", ErrInvalid)
	}

	cardWeights := make([]float64, len(document.DirectorCards))
	for index, card := range document.DirectorCards {
		cardWeights[index] = float64(card.DurationWeight)
	}
	cardDurations, err := allocateH3Milliseconds(audio.DurationMS, cardWeights)
	allocatorVersion := h3TimelineAllocatorV1
	if audio.Method == "per_line_tts_probe" {
		allocatorVersion = "h3-per-line-tts/v1"
		cardDurations, err = h3MeasuredCardDurations(document, audio)
	} else if audio.Method != "" || len(audio.Lines) != 0 {
		return timeline, fmt.Errorf("%w: unsupported H3 audio measurement method", ErrInvalid)
	}
	if err != nil {
		return timeline, fmt.Errorf("%w: director card allocation: %v", ErrInvalid, err)
	}

	timeline = H3CanonicalTimeline{
		SchemaVersion:      h3CanonicalTimelineSchemaV1,
		DirectorRevisionID: strings.TrimSpace(directorRevisionID),
		AudioAssetID:       strings.TrimSpace(audio.AssetID),
		AudioContentHash:   strings.TrimSpace(audio.ContentHash),
		AudioDurationMS:    audio.DurationMS,
		AllocatorVersion:   allocatorVersion,
		Cards:              make([]H3CanonicalCard, 0, len(document.DirectorCards)),
	}
	var cardCursor int64
	if audio.Method == "per_line_tts_probe" {
		snapshot := audio
		snapshot.Lines = append([]H3LineAudioMeasurement(nil), audio.Lines...)
		timeline.AudioMeasurement = &snapshot
	}
	for index, directorCard := range document.DirectorCards {
		duration := cardDurations[index]
		card := H3CanonicalCard{
			SourceIndex:         directorCard.SourceIndex,
			SourceKey:           directorCard.SourceKey,
			CanonicalStartMS:    cardCursor,
			CanonicalEndMS:      cardCursor + duration,
			CanonicalDurationMS: duration,
			MicroShots:          make([]H3CanonicalMicroShot, 0, len(directorCard.MicroShots)),
		}
		microWeights := make([]float64, len(directorCard.MicroShots))
		for shotIndex, shot := range directorCard.MicroShots {
			microWeights[shotIndex] = float64(shot.Weight)
		}
		microDurations, allocateErr := allocateH3Milliseconds(duration, microWeights)
		if allocateErr != nil {
			return H3CanonicalTimeline{}, fmt.Errorf("%w: director_cards[%d] micro-shot allocation: %v", ErrInvalid, index, allocateErr)
		}
		microCursor := card.CanonicalStartMS
		for shotIndex, shot := range directorCard.MicroShots {
			microDuration := microDurations[shotIndex]
			card.MicroShots = append(card.MicroShots, H3CanonicalMicroShot{
				MicroShotKey:        shot.MicroShotKey,
				CanonicalStartMS:    microCursor,
				CanonicalEndMS:      microCursor + microDuration,
				CanonicalDurationMS: microDuration,
			})
			microCursor += microDuration
		}
		timeline.Cards = append(timeline.Cards, card)
		cardCursor += duration
	}
	input, err := json.Marshal(struct {
		DirectorRevisionID string             `json:"director_revision_id"`
		Document           H3DirectorDocument `json:"document"`
		Audio              H3AudioMeasurement `json:"audio"`
		AllocatorVersion   string             `json:"allocator_version"`
	}{directorRevisionID, document, audio, allocatorVersion})
	if err != nil {
		return H3CanonicalTimeline{}, fmt.Errorf("hash H3 timeline input: %w", err)
	}
	timeline.InputHash = fmt.Sprintf("%x", sha256.Sum256(input))
	return timeline, nil
}

// AllocateH3SemanticTimeline is the deterministic no-TTS path. It deliberately
// does not claim an audio asset: each card receives milliseconds derived only
// from its persisted semantic duration weight, then the normal compiler uses
// the same segmentation and prompt-template boundary as measured timelines.
func AllocateH3SemanticTimeline(directorRevisionID string, document H3DirectorDocument) (H3CanonicalTimeline, error) {
	var total int64
	for index, card := range document.DirectorCards {
		weight := int64(math.Ceil(float64(card.DurationWeight)))
		if weight <= 0 || weight > math.MaxInt64/1000-total {
			return H3CanonicalTimeline{}, fmt.Errorf("%w: director_cards[%d] has invalid duration_weight", ErrInvalid, index)
		}
		total += weight * 1000
	}
	if total <= 0 {
		return H3CanonicalTimeline{}, fmt.Errorf("%w: director_cards must not be empty", ErrInvalid)
	}
	timeline, err := AllocateH3CanonicalTimeline(directorRevisionID, document, H3AudioMeasurement{
		AssetID: "semantic-weight", ContentHash: "semantic-weight", DurationMS: total,
		VideoSourceRevision: document.VideoSourceRevision, VideoSourceHash: document.VideoSourceHash,
	})
	if err != nil {
		return H3CanonicalTimeline{}, err
	}
	timeline.AudioAssetID = ""
	timeline.AudioContentHash = ""
	timeline.AudioMeasurement = nil
	timeline.AllocatorVersion = "h3-semantic-weight/v1"
	input, err := json.Marshal(struct {
		DirectorRevisionID string             `json:"director_revision_id"`
		Document           H3DirectorDocument `json:"document"`
		AllocatorVersion   string             `json:"allocator_version"`
	}{directorRevisionID, document, timeline.AllocatorVersion})
	if err != nil {
		return H3CanonicalTimeline{}, fmt.Errorf("hash semantic H3 timeline input: %w", err)
	}
	timeline.InputHash = fmt.Sprintf("%x", sha256.Sum256(input))
	return timeline, nil
}

func h3MeasuredCardDurations(document H3DirectorDocument, audio H3AudioMeasurement) ([]int64, error) {
	if len(audio.Lines) != len(document.DirectorCards) {
		return nil, fmt.Errorf("missing measured video-source lines")
	}
	durations := make([]int64, len(audio.Lines))
	var total int64
	for i, line := range audio.Lines {
		card := document.DirectorCards[i]
		if line.SourceKey != card.SourceKey || line.SourceTextHash != card.SourceTextHash || line.ContentHash == "" || line.DurationMS <= 0 || line.DurationMS > math.MaxInt64-total {
			return nil, fmt.Errorf("invalid or stale measured line %d", i+1)
		}
		durations[i] = line.DurationMS
		total += line.DurationMS
	}
	if total != audio.DurationMS {
		return nil, fmt.Errorf("line duration sum does not match measured total")
	}
	return durations, nil
}

func allocateH3Milliseconds(total int64, weights []float64) ([]int64, error) {
	if total < 0 {
		return nil, fmt.Errorf("total milliseconds must not be negative")
	}
	if len(weights) == 0 {
		return nil, fmt.Errorf("at least one weight is required")
	}
	var weightTotal float64
	for index, weight := range weights {
		if math.IsNaN(weight) || math.IsInf(weight, 0) || weight <= 0 {
			return nil, fmt.Errorf("weight[%d] must be a finite positive number", index)
		}
		weightTotal += weight
	}
	if math.IsNaN(weightTotal) || math.IsInf(weightTotal, 0) || weightTotal <= 0 {
		return nil, fmt.Errorf("weight total must be a finite positive number")
	}
	out := make([]int64, len(weights))
	var allocated int64
	for index := 0; index < len(weights)-1; index++ {
		share := int64(math.Floor(float64(total) * weights[index] / weightTotal))
		out[index] = share
		allocated += share
	}
	out[len(out)-1] = total - allocated
	return out, nil
}
