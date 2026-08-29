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

type settingsStoreExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func NewSettingsStore(db *sql.DB) *SettingsStore {
	return &SettingsStore{db: db}
}

func (s *SettingsStore) SaveBatch(ctx context.Context, userID int64, batchID string, settings Settings) error {
	return s.saveWith(ctx, s.db, userID, batchID, settingsScopeBatch, "", "", settings, false)
}

func (s *SettingsStore) SaveBatchAndClearVideoOverrides(ctx context.Context, userID int64, batchID string, settings Settings, clearVideoOverrides bool) error {
	if !clearVideoOverrides {
		return s.SaveBatch(ctx, userID, batchID, settings)
	}
	if s == nil || s.db == nil {
		return fmt.Errorf("batch factory settings database is not configured")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.saveWith(ctx, tx, userID, batchID, settingsScopeBatch, "", "", settings, false); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_batch_factory_settings
WHERE user_id = ? AND batch_id = ? AND scope = ?`, userID, strings.TrimSpace(batchID), settingsScopeVideo); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SettingsStore) SaveItemOverride(ctx context.Context, userID int64, batchID, itemID string, settings Settings) error {
	return s.saveWith(ctx, s.db, userID, batchID, settingsScopeItem, itemID, "", settings, true)
}

func (s *SettingsStore) SaveVideoOverride(ctx context.Context, userID int64, batchID, itemID, videoID string, settings Settings) error {
	return s.saveWith(ctx, s.db, userID, batchID, settingsScopeVideo, itemID, videoID, settings, true)
}

func (s *SettingsStore) saveWith(ctx context.Context, executor settingsStoreExecutor, userID int64, batchID, scope, itemID, videoID string, settings Settings, deleteWhenEmpty bool) error {
	if s == nil || s.db == nil || executor == nil {
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
		_, err := executor.ExecContext(ctx, `DELETE FROM shuihuo_batch_factory_settings
WHERE user_id = ? AND batch_id = ? AND scope = ? AND item_id = ? AND video_id = ?`, userID, batchID, scope, itemID, videoID)
		return err
	}
	raw, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encode batch factory settings: %w", err)
	}
	_, err = executor.ExecContext(ctx, `INSERT INTO shuihuo_batch_factory_settings
(user_id, batch_id, scope, item_id, video_id, settings_json)
VALUES(?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP`, userID, batchID, scope, itemID, videoID, string(raw))
	return err
}

func (s *SettingsStore) LoadBatchState(ctx context.Context, userID int64, batchID string) (PersistedSettingsState, error) {
	return s.loadBatchStateWith(ctx, s.db, userID, batchID, false)
}

func (s *SettingsStore) loadBatchStateWith(ctx context.Context, executor settingsStoreExecutor, userID int64, batchID string, lock bool) (PersistedSettingsState, error) {
	state := PersistedSettingsState{
		Items:  map[string]Settings{},
		Videos: map[string]map[string]Settings{},
	}
	if s == nil || s.db == nil || executor == nil {
		return state, fmt.Errorf("batch factory settings database is not configured")
	}
	batchID = strings.TrimSpace(batchID)
	if userID < 1 || batchID == "" || len(batchID) > 96 {
		return state, fmt.Errorf("invalid batch factory settings identity")
	}
	query := `SELECT scope, item_id, video_id, settings_json
FROM shuihuo_batch_factory_settings
WHERE user_id = ? AND batch_id = ?
ORDER BY scope, item_id, video_id`
	if lock {
		query += ` FOR UPDATE`
	}
	rows, err := executor.QueryContext(ctx, query, userID, batchID)
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

func (s *SettingsStore) BootstrapBatchState(ctx context.Context, userID int64, batchID string, legacy PersistedSettingsState) (PersistedSettingsState, error) {
	if s == nil || s.db == nil {
		return PersistedSettingsState{}, fmt.Errorf("batch factory settings database is not configured")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return PersistedSettingsState{}, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := s.loadBatchStateWith(ctx, tx, userID, batchID, true)
	if err != nil {
		return existing, err
	}
	if existing.Batch != nil {
		return existing, nil
	}

	for itemID, input := range legacy.Items {
		next := NormalizeSparseOverride(input, nil, nil)
		if len(next) == 0 {
			continue
		}
		if err := s.saveWith(ctx, tx, userID, batchID, settingsScopeItem, itemID, "", next, true); err != nil {
			return PersistedSettingsState{}, err
		}
	}
	for itemID, videos := range legacy.Videos {
		for videoID, input := range videos {
			next := NormalizeSparseOverride(input, nil, nil)
			if len(next) == 0 {
				continue
			}
			if err := s.saveWith(ctx, tx, userID, batchID, settingsScopeVideo, itemID, videoID, next, true); err != nil {
				return PersistedSettingsState{}, err
			}
		}
	}

	if err := s.saveWith(ctx, tx, userID, batchID, settingsScopeBatch, "", "", NormalizeSettings(legacy.Batch, nil), false); err != nil {
		return PersistedSettingsState{}, err
	}
	state, err := s.loadBatchStateWith(ctx, tx, userID, batchID, false)
	if err != nil {
		return PersistedSettingsState{}, err
	}
	if err := tx.Commit(); err != nil {
		return PersistedSettingsState{}, err
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

func (s *SettingsStore) BatchExists(ctx context.Context, userID int64, batchID string) (bool, error) {
	_, exists, err := s.LoadBatch(ctx, userID, batchID)
	return exists, err
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
