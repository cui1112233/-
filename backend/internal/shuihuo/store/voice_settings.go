package store

import (
	"context"
	"database/sql"
	"errors"

	"qiantie/backend/internal/shuihuo/domain"
)

var ErrSegmentVoiceSettingsUnavailable = errors.New("segment voice settings are unavailable")

type SegmentVoiceSettings struct{ db *sql.DB }

func NewSegmentVoiceSettings(db *sql.DB) *SegmentVoiceSettings { return &SegmentVoiceSettings{db: db} }

func (s *SegmentVoiceSettings) ListByProject(ctx context.Context, ownerID, projectID int64) (map[int64]domain.SegmentVoiceSettings, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT vs.segment_id, vs.voice_asset_id, vs.speech_rate, vs.pitch FROM shuihuo_segment_voice_settings vs JOIN shuihuo_projects p ON p.id = vs.project_id WHERE vs.project_id = ? AND p.user_id = ? ORDER BY vs.segment_id`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make(map[int64]domain.SegmentVoiceSettings)
	for rows.Next() {
		var item domain.SegmentVoiceSettings
		if err := rows.Scan(&item.SegmentID, &item.VoiceAssetID, &item.SpeechRate, &item.Pitch); err != nil {
			return nil, err
		}
		items[item.SegmentID] = item
	}
	return items, rows.Err()
}

func (s *SegmentVoiceSettings) Save(ctx context.Context, ownerID, segmentID int64, settings domain.SegmentVoiceSettings) (domain.SegmentVoiceSettings, error) {
	var projectID int64
	err := s.db.QueryRowContext(ctx, `SELECT s.project_id FROM shuihuo_segments s JOIN shuihuo_projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ?`, segmentID, ownerID).Scan(&projectID)
	if err != nil {
		return domain.SegmentVoiceSettings{}, err
	}
	if settings.VoiceAssetID != nil {
		var voiceID int64
		err := s.db.QueryRowContext(ctx, `SELECT id FROM shuihuo_assets WHERE id = ? AND project_id = ? AND category = 'voice' AND is_current = TRUE`, *settings.VoiceAssetID, projectID).Scan(&voiceID)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.SegmentVoiceSettings{}, ErrSegmentVoiceSettingsUnavailable
		}
		if err != nil {
			return domain.SegmentVoiceSettings{}, err
		}
	}
	settings.SegmentID = segmentID
	_, err = s.db.ExecContext(ctx, `INSERT INTO shuihuo_segment_voice_settings(segment_id, project_id, voice_asset_id, speech_rate, pitch) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE voice_asset_id = VALUES(voice_asset_id), speech_rate = VALUES(speech_rate), pitch = VALUES(pitch)`, settings.SegmentID, projectID, settings.VoiceAssetID, settings.SpeechRate, settings.Pitch)
	if err != nil {
		return domain.SegmentVoiceSettings{}, err
	}
	return settings, nil
}
