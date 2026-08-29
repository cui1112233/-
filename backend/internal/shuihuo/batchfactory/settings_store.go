package batchfactory

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	settingsScopeBatch = "batch"
	settingsScopeItem  = "item"
	settingsScopeVideo = "video"
)

type PersistedSettingsState struct {
	Batch  Settings                       `json:"settings"`
	Items  map[string]Settings            `json:"itemOverrides"`
	Videos map[string]map[string]Settings `json:"videoOverrides"`
}

type SettingsStore struct {
	db *sql.DB
}

func NewSettingsStore(db *sql.DB) *SettingsStore {
	return &SettingsStore{db: db}
}

func (s *SettingsStore) SaveBatch(ctx context.Context, userID int64, batchID string, settings Settings) error {
	return s.save(ctx, userID, batchID, settingsScopeBatch, "", "", settings, false)
}

func (s *SettingsStore) SaveItemOverride(ctx context.Context, userID int64, batchID, itemID string, settings Settings) error {
	return s.save(ctx, userID, batchID, settingsScopeItem, itemID, "", settings, true)
}

func (s *SettingsStore) SaveVideoOverride(ctx context.Context, userID int64, batchID, itemID, videoID string, settings Settings) error {
	return s.save(ctx, userID, batchID, settingsScopeVideo, itemID, videoID, settings, true)
}

func (s *SettingsStore) save(ctx context.Context, userID int64, batchID, scope, itemID, videoID string, settings Settings, deleteWhenEmpty bool) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("batch factory settings database is not configured")
	}
	batchID = strings.TrimSpace(batchID)
	itemID = strings.TrimSpace(itemID)
	videoID = strings.TrimSpace(videoID)
	if userID < 1 || batchID == "" || len(batchID) > 96 || len(itemID) > 96 || len(videoID) > 96 {
		return fmt.Errorf("invalid batch factory settings identity")
	}
	if scope == settingsScopeItem && itemID == "" {
		return fmt.Errorf("item id is required")
	}
	if scope == settingsScopeVideo && (itemID == "" || videoID == "") {
		return fmt.Errorf("item id and video id are required")
	}
	if deleteWhenEmpty && len(settings) == 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM shuihuo_batch_factory_settings
WHERE user_id = ? AND batch_id = ? AND scope = ? AND item_id = ? AND video_id = ?`, userID, batchID, scope, itemID, videoID)
		return err
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encode batch factory settings: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO shuihuo_batch_factory_settings
(user_id, batch_id, scope, item_id, video_id, settings_json)
VALUES(?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP`, userID, batchID, scope, itemID, videoID, string(raw))
	return err
}

func (s *SettingsStore) LoadBatchState(ctx context.Context, userID int64, batchID string) (PersistedSettingsState, error) {
	state := PersistedSettingsState{
		Items:  map[string]Settings{},
		Videos: map[string]map[string]Settings{},
	}
	if s == nil || s.db == nil {
		return state, fmt.Errorf("batch factory settings database is not configured")
	}
	batchID = strings.TrimSpace(batchID)
	if userID < 1 || batchID == "" || len(batchID) > 96 {
		return state, fmt.Errorf("invalid batch factory settings identity")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT scope, item_id, video_id, settings_json
FROM shuihuo_batch_factory_settings
WHERE user_id = ? AND batch_id = ?
ORDER BY scope, item_id, video_id`, userID, batchID)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var scope, itemID, videoID string
		var raw []byte
		if err := rows.Scan(&scope, &itemID, &videoID, &raw); err != nil {
			return state, err
		}
		settings := Settings{}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &settings); err != nil {
				return state, fmt.Errorf("decode batch factory settings: %w", err)
			}
		}
		switch scope {
		case settingsScopeBatch:
			state.Batch = settings
		case settingsScopeItem:
			if itemID != "" {
				state.Items[itemID] = settings
			}
		case settingsScopeVideo:
			if itemID != "" && videoID != "" {
				if state.Videos[itemID] == nil {
					state.Videos[itemID] = map[string]Settings{}
				}
				state.Videos[itemID][videoID] = settings
			}
		}
	}
	if err := rows.Err(); err != nil {
		return state, err
	}
	return state, nil
}

func (s *SettingsStore) LoadBatch(ctx context.Context, userID int64, batchID string) (Settings, bool, error) {
	state, err := s.LoadBatchState(ctx, userID, batchID)
	if err != nil {
		return nil, false, err
	}
	if state.Batch == nil {
		return nil, false, nil
	}
	return state.Batch, true, nil
}

func (s *SettingsStore) LoadItemOverride(ctx context.Context, userID int64, batchID, itemID string) (Settings, bool, error) {
	state, err := s.LoadBatchState(ctx, userID, batchID)
	if err != nil {
		return nil, false, err
	}
	settings, ok := state.Items[strings.TrimSpace(itemID)]
	return settings, ok, nil
}

func (s *SettingsStore) LoadVideoOverride(ctx context.Context, userID int64, batchID, itemID, videoID string) (Settings, bool, error) {
	state, err := s.LoadBatchState(ctx, userID, batchID)
	if err != nil {
		return nil, false, err
	}
	videos := state.Videos[strings.TrimSpace(itemID)]
	settings, ok := videos[strings.TrimSpace(videoID)]
	return settings, ok, nil
}
