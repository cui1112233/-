package batchfactoryv11

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
)

type H3LineAudioInput struct {
	SourceKey   string `json:"source_key"`
	SourceText  string `json:"source_text"`
	AudioBase64 string `json:"audio_base64"`
}

func (s *H3KernelService) MeasureLineAudio(ctx context.Context, owner, batchID, bookID, directorID, fingerprint string, lines []H3LineAudioInput) (H3AudioMeasurementRevision, error) {
	if s == nil || s.Store == nil {
		return H3AudioMeasurementRevision{}, ErrUnavailable
	}
	repository, ok := s.Store.(H3Repository)
	if !ok {
		return H3AudioMeasurementRevision{}, ErrUnavailable
	}
	batch, err := s.Store.GetBatch(ctx, owner, batchID)
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	book, err := bookFromBatch(batch, bookID)
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	if book.DirectorRevision == nil || book.DirectorRevision.ID != directorID || book.DirectorRevision.Output.H3Director == nil {
		return H3AudioMeasurementRevision{}, ErrConflict
	}
	document := *book.DirectorRevision.Output.H3Director
	if len(lines) != len(document.DirectorCards) || len(lines) == 0 || strings.TrimSpace(fingerprint) == "" {
		return H3AudioMeasurementRevision{}, ErrInvalid
	}
	probe := s.AudioProbe
	if probe == nil {
		probe = FFprobeH3AudioDuration{}
	}
	measurement := H3AudioMeasurement{Method: "per_line_tts_probe", TTSFingerprint: fingerprint, VideoSourceRevision: document.VideoSourceRevision, VideoSourceHash: document.VideoSourceHash}
	var bytesTotal int
	for i, line := range lines {
		card := document.DirectorCards[i]
		if line.SourceKey != card.SourceKey || line.SourceText != card.SourceText {
			return H3AudioMeasurementRevision{}, fmt.Errorf("%w: line %d does not match frozen video source", ErrConflict, i+1)
		}
		audio, err := base64.StdEncoding.DecodeString(line.AudioBase64)
		bytesTotal += len(audio)
		if err != nil || len(audio) == 0 || bytesTotal > maxH3AudioBytes {
			return H3AudioMeasurementRevision{}, ErrInvalid
		}
		duration, err := probe.DurationMS(ctx, audio)
		if err != nil {
			return H3AudioMeasurementRevision{}, err
		}
		if duration <= 0 || duration > 24*60*60*1000 {
			return H3AudioMeasurementRevision{}, ErrInvalid
		}
		measurement.Lines = append(measurement.Lines, H3LineAudioMeasurement{SourceKey: card.SourceKey, SourceTextHash: card.SourceTextHash, ContentHash: fmt.Sprintf("%x", sha256.Sum256(audio)), DurationMS: duration})
		measurement.DurationMS += duration
	}
	if _, err := h3MeasuredCardDurations(document, measurement); err != nil {
		return H3AudioMeasurementRevision{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	raw, err := json.Marshal(measurement)
	if err != nil {
		return H3AudioMeasurementRevision{}, err
	}
	measurement.ContentHash = fmt.Sprintf("%x", sha256.Sum256(raw))
	measurement.AssetID = "h3-lines-" + measurement.ContentHash[:24]
	return repository.PersistH3AudioMeasurement(ctx, owner, batchID, bookID, measurement)
}
