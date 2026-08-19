package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"qiantie/backend/internal/shuihuo/domain"
)

var (
	ErrSegmentAssetUnavailable           = errors.New("segment asset is unavailable")
	ErrCharacterVoiceUnavailable         = errors.New("character voice is unavailable")
	ErrInvalidAssetGenerationAspectRatio = errors.New("invalid asset generation aspect ratio")
)

type Assets struct{ db *sql.DB }

func NewAssets(db *sql.DB) *Assets { return &Assets{db: db} }

func (s *Assets) Create(ctx context.Context, ownerID, projectID int64, asset domain.Asset) (domain.Asset, error) {
	if err := validateCharacterVoice(ctx, s.db, ownerID, projectID, asset.Category, asset.VoiceAssetID); err != nil {
		return domain.Asset{}, err
	}
	asset.IsCurrent = true
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_assets(project_id, asset_type_id, category, name, prompt, voice_asset_id, reference_object_key, source, manually_edited, is_current)
SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, asset.AssetTypeID, asset.Category, asset.Name, asset.Prompt, asset.VoiceAssetID, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, asset.IsCurrent, projectID, ownerID)
	if err != nil {
		return domain.Asset{}, err
	}
	if err := requireAffected(result); err != nil {
		return domain.Asset{}, err
	}
	asset.ID, err = result.LastInsertId()
	if err != nil {
		return domain.Asset{}, err
	}
	asset.ProjectID = projectID
	return asset, nil
}

func (s *Assets) Get(ctx context.Context, ownerID, assetID int64) (domain.Asset, error) {
	var asset domain.Asset
	err := s.db.QueryRowContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.voice_asset_id, a.reference_object_key, a.source, a.manually_edited, a.is_current
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.id = ? AND p.user_id = ?
`, assetID, ownerID).Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.VoiceAssetID, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited, &asset.IsCurrent)
	return asset, err
}

func (s *Assets) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Asset, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.voice_asset_id, a.reference_object_key, a.source, a.manually_edited, a.is_current
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.project_id = ? AND p.user_id = ? AND a.is_current = TRUE
ORDER BY a.created_at ASC, a.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.VoiceAssetID, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited, &asset.IsCurrent); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

// ListBySegment returns only the project presets explicitly bound to a
// storyboard. Prompt generation must not leak unrelated project assets into a
// segment, otherwise different characters and scenes get mixed together.
func (s *Assets) ListBySegment(ctx context.Context, ownerID, segmentID int64) ([]domain.Asset, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.voice_asset_id, a.reference_object_key, a.source, a.manually_edited, a.is_current
FROM shuihuo_segment_assets sa
JOIN shuihuo_assets a ON a.id = sa.asset_id
JOIN shuihuo_segments s ON s.id = sa.segment_id AND s.project_id = a.project_id
JOIN shuihuo_projects p ON p.id = s.project_id
WHERE sa.segment_id = ? AND p.user_id = ? AND a.is_current = TRUE
ORDER BY a.created_at ASC, a.id ASC
`, segmentID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.VoiceAssetID, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited, &asset.IsCurrent); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

// ListReferenceObjectKeysBySegment returns the exact images available to the
// visual assets bound to one storyboard segment. A generated primary asset
// image takes precedence over the manually uploaded reference image. Nothing
// outside this segment's explicit bindings can enter the image-generation
// request.
func (s *Assets) ListReferenceObjectKeysBySegment(ctx context.Context, ownerID, segmentID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT COALESCE(
  (
    SELECT ai.object_key
    FROM shuihuo_asset_images ai
    WHERE ai.asset_id = a.id AND ai.is_primary = TRUE
    ORDER BY ai.updated_at DESC, ai.id DESC
    LIMIT 1
  ),
  NULLIF(a.reference_object_key, '')
)
FROM shuihuo_segment_assets sa
JOIN shuihuo_assets a ON a.id = sa.asset_id
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE sa.segment_id = ?
  AND p.user_id = ?
  AND a.is_current = TRUE
  AND a.category IN ('character', 'scene', 'prop')
ORDER BY a.created_at ASC, a.id ASC
`, segmentID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := make(map[string]struct{})
	keys := make([]string, 0)
	for rows.Next() {
		var objectKey sql.NullString
		if err := rows.Scan(&objectKey); err != nil {
			return nil, err
		}
		if !objectKey.Valid || strings.TrimSpace(objectKey.String) == "" {
			continue
		}
		if _, duplicate := seen[objectKey.String]; duplicate {
			continue
		}
		seen[objectKey.String] = struct{}{}
		keys = append(keys, objectKey.String)
	}
	return keys, rows.Err()
}

func (s *Assets) Update(ctx context.Context, ownerID int64, asset domain.Asset) error {
	if err := validateCharacterVoice(ctx, s.db, ownerID, asset.ProjectID, asset.Category, asset.VoiceAssetID); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
SET a.asset_type_id = ?, a.category = ?, a.name = ?, a.prompt = ?, a.voice_asset_id = ?, a.reference_object_key = ?, a.source = ?, a.manually_edited = ?
WHERE a.id = ? AND p.user_id = ?
`, asset.AssetTypeID, asset.Category, asset.Name, asset.Prompt, asset.VoiceAssetID, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, asset.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Assets) ReplaceCurrentAICandidates(ctx context.Context, ownerID, projectID int64, candidates []domain.Asset) ([]domain.Asset, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var lockedID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM shuihuo_projects WHERE id = ? AND user_id = ? FOR UPDATE`, projectID, ownerID).Scan(&lockedID); err != nil {
		return nil, err
	}
	existing, err := currentAICandidates(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	candidates = reuseAICandidateIDs(existing, candidates)
	usedIDs := make(map[int64]struct{}, len(candidates))
	created := make([]domain.Asset, 0, len(candidates))
	for _, candidate := range candidates {
		candidate.ProjectID, candidate.Source, candidate.ManuallyEdited, candidate.IsCurrent = projectID, "ai_candidate", false, true
		if candidate.ID != 0 {
			if _, err := tx.ExecContext(ctx, `
UPDATE shuihuo_assets
SET asset_type_id = COALESCE(?, asset_type_id), category = ?, name = ?, prompt = ?, reference_object_key = ?, source = 'ai_candidate', manually_edited = FALSE, is_current = TRUE
WHERE id = ? AND project_id = ?`, candidate.AssetTypeID, candidate.Category, candidate.Name, candidate.Prompt, candidate.ReferenceObjectKey, candidate.ID, projectID); err != nil {
				return nil, err
			}
			usedIDs[candidate.ID] = struct{}{}
			created = append(created, candidate)
			continue
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_assets(project_id, asset_type_id, category, name, prompt, reference_object_key, source, manually_edited, is_current) VALUES(?, ?, ?, ?, ?, ?, 'ai_candidate', FALSE, TRUE)`, projectID, candidate.AssetTypeID, candidate.Category, candidate.Name, candidate.Prompt, candidate.ReferenceObjectKey)
		if err != nil {
			return nil, err
		}
		candidate.ID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
		usedIDs[candidate.ID] = struct{}{}
		created = append(created, candidate)
	}
	for _, asset := range existing {
		if _, retained := usedIDs[asset.ID]; retained {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE shuihuo_assets SET is_current = FALSE WHERE id = ? AND EXISTS (SELECT 1 FROM shuihuo_asset_images WHERE asset_id = ?)`, asset.ID, asset.ID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_assets WHERE id = ? AND NOT EXISTS (SELECT 1 FROM shuihuo_asset_images WHERE asset_id = ?)`, asset.ID, asset.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created, nil
}

func currentAICandidates(ctx context.Context, tx *sql.Tx, projectID int64) ([]domain.Asset, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT id, project_id, asset_type_id, category, name, prompt, reference_object_key, source, manually_edited, is_current
FROM shuihuo_assets
WHERE project_id = ? AND source = 'ai_candidate' AND manually_edited = FALSE AND is_current = TRUE
ORDER BY created_at ASC, id ASC
FOR UPDATE`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited, &asset.IsCurrent); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func reuseAICandidateIDs(existing, candidates []domain.Asset) []domain.Asset {
	available := make(map[string][]int64, len(existing))
	for _, asset := range existing {
		key := assetIdentityKey(asset.Category, asset.Name)
		available[key] = append(available[key], asset.ID)
	}
	for index := range candidates {
		key := assetIdentityKey(candidates[index].Category, candidates[index].Name)
		ids := available[key]
		if len(ids) == 0 {
			continue
		}
		candidates[index].ID = ids[0]
		available[key] = ids[1:]
	}
	return candidates
}

func assetIdentityKey(category, name string) string {
	return strings.ToLower(strings.TrimSpace(category)) + "\x00" + strings.ToLower(strings.TrimSpace(name))
}

func (s *Assets) Delete(ctx context.Context, ownerID, assetID int64) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE shuihuo_assets a JOIN shuihuo_projects p ON p.id = a.project_id SET a.voice_asset_id = NULL WHERE a.voice_asset_id = ? AND p.user_id = ?`, assetID, ownerID); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `
DELETE a FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.id = ? AND p.user_id = ?`, assetID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func validateCharacterVoice(ctx context.Context, db *sql.DB, ownerID, projectID int64, category string, voiceAssetID *int64) error {
	if voiceAssetID == nil {
		return nil
	}
	if category != "character" || *voiceAssetID < 1 {
		return ErrCharacterVoiceUnavailable
	}
	var matchedID int64
	err := db.QueryRowContext(ctx, `
SELECT voice.id
FROM shuihuo_assets voice
JOIN shuihuo_projects p ON p.id = voice.project_id
WHERE voice.id = ? AND voice.project_id = ? AND voice.category = 'voice' AND voice.is_current = TRUE AND p.user_id = ?
`, *voiceAssetID, projectID, ownerID).Scan(&matchedID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCharacterVoiceUnavailable
	}
	return err
}

func (s *Assets) SaveGenerationConfig(ctx context.Context, ownerID, projectID int64, config domain.AssetGenerationConfig) error {
	if !validAssetGenerationAspectRatio(config.AspectRatio) {
		return ErrInvalidAssetGenerationAspectRatio
	}
	var ownedProjectID int64
	if err := s.db.QueryRowContext(ctx, `
SELECT id
FROM shuihuo_projects
WHERE id = ? AND user_id = ?`, projectID, ownerID).Scan(&ownedProjectID); err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_asset_generation_configs(
  project_id, user_id, text_model_id, image_model_id, audio_model_id, prompt_template_id,
  character_preset_id, scene_preset_id, style_id, character_sheet_preset_id,
  aspect_ratio, style_reference_media_id, three_view
)
SELECT p.id, p.user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects p
WHERE p.id = ? AND p.user_id = ?
ON DUPLICATE KEY UPDATE
  text_model_id = VALUES(text_model_id),
  image_model_id = VALUES(image_model_id),
  audio_model_id = VALUES(audio_model_id),
  prompt_template_id = VALUES(prompt_template_id),
  character_preset_id = VALUES(character_preset_id),
  scene_preset_id = VALUES(scene_preset_id),
  style_id = VALUES(style_id),
  character_sheet_preset_id = VALUES(character_sheet_preset_id),
  aspect_ratio = VALUES(aspect_ratio),
  style_reference_media_id = VALUES(style_reference_media_id),
  three_view = VALUES(three_view)
	`, config.TextModelID, config.ImageModelID, config.AudioModelID, config.PromptTemplateID,
		config.CharacterPresetID, config.ScenePresetID, config.StyleID, config.CharacterSheetPresetID,
		config.AspectRatio, config.StyleReferenceMediaID, config.ThreeView, projectID, ownerID)
	if err != nil {
		return err
	}
	// MySQL reports zero affected rows when ON DUPLICATE KEY UPDATE receives
	// values identical to the existing row. Project ownership was checked
	// above, so zero here is a successful no-op rather than sql.ErrNoRows.
	_, err = result.RowsAffected()
	return err
}

func (s *Assets) GetGenerationConfig(ctx context.Context, ownerID, projectID int64) (domain.AssetGenerationConfig, error) {
	var config domain.AssetGenerationConfig
	err := s.db.QueryRowContext(ctx, `
SELECT c.project_id, c.text_model_id, c.image_model_id, c.audio_model_id, c.prompt_template_id,
       c.character_preset_id, c.scene_preset_id, c.style_id, c.character_sheet_preset_id,
       c.aspect_ratio, c.style_reference_media_id,
       c.three_view, c.updated_at
FROM shuihuo_asset_generation_configs c
JOIN shuihuo_projects p ON p.id = c.project_id AND p.user_id = c.user_id
WHERE c.project_id = ? AND c.user_id = ? AND p.user_id = ?
`, projectID, ownerID, ownerID).Scan(
		&config.ProjectID,
		&config.TextModelID,
		&config.ImageModelID,
		&config.AudioModelID,
		&config.PromptTemplateID,
		&config.CharacterPresetID,
		&config.ScenePresetID,
		&config.StyleID,
		&config.CharacterSheetPresetID,
		&config.AspectRatio,
		&config.StyleReferenceMediaID,
		&config.ThreeView,
		&config.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return domain.AssetGenerationConfig{}, nil
	}
	return config, err
}

func validAssetGenerationAspectRatio(aspectRatio string) bool {
	switch aspectRatio {
	case "16:9", "9:16", "1:1":
		return true
	default:
		return false
	}
}

// ReplaceSegmentAssets updates a storyboard's project-local preset bindings in
// the same project lock used by structural edits. Active media tasks retain a
// prompt snapshot, so changing bindings while they run would be ambiguous.
func (s *Assets) ReplaceSegmentAssets(ctx context.Context, ownerID, segmentID int64, assetIDs []int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	projectID, err := lockOwnedProjectForSegment(ctx, tx, ownerID, segmentID)
	if err != nil {
		return err
	}
	if err := requireNoActiveTasks(ctx, sourceUnitTxAdapter{tx: tx}, projectID); err != nil {
		return err
	}
	if err := requireProjectAssets(ctx, tx, projectID, assetIDs); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM shuihuo_segment_assets WHERE segment_id = ?`, segmentID); err != nil {
		return err
	}
	for _, assetID := range assetIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO shuihuo_segment_assets(segment_id, asset_id) VALUES(?, ?)`, segmentID, assetID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func requireProjectAssets(ctx context.Context, tx *sql.Tx, projectID int64, assetIDs []int64) error {
	if len(assetIDs) == 0 {
		return nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(assetIDs)), ",")
	args := make([]any, 0, len(assetIDs)+1)
	args = append(args, projectID)
	for _, assetID := range assetIDs {
		args = append(args, assetID)
	}
	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT id FROM shuihuo_assets WHERE project_id = ? AND id IN (%s)`, placeholders), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != len(assetIDs) {
		return ErrSegmentAssetUnavailable
	}
	return nil
}
