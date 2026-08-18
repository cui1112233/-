package store

import (
	"context"
	"database/sql"
	"errors"

	"qiantie/backend/internal/shuihuo/domain"
)

type Assets struct{ db *sql.DB }

func NewAssets(db *sql.DB) *Assets { return &Assets{db: db} }

func (s *Assets) Create(ctx context.Context, ownerID, projectID int64, asset domain.Asset) (domain.Asset, error) {
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_assets(project_id, asset_type_id, category, name, prompt, reference_object_key, source, manually_edited)
SELECT id, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects
WHERE id = ? AND user_id = ?
`, asset.AssetTypeID, asset.Category, asset.Name, asset.Prompt, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, projectID, ownerID)
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
	SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.reference_object_key, a.source, a.manually_edited
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.id = ? AND p.user_id = ?
	`, assetID, ownerID).Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited)
	return asset, err
}

func (s *Assets) ListByProject(ctx context.Context, ownerID, projectID int64) ([]domain.Asset, error) {
	rows, err := s.db.QueryContext(ctx, `
	SELECT a.id, a.project_id, a.asset_type_id, a.category, a.name, a.prompt, a.reference_object_key, a.source, a.manually_edited
FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.project_id = ? AND p.user_id = ?
ORDER BY a.created_at ASC, a.id ASC
`, projectID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	assets := make([]domain.Asset, 0)
	for rows.Next() {
		var asset domain.Asset
		if err := rows.Scan(&asset.ID, &asset.ProjectID, &asset.AssetTypeID, &asset.Category, &asset.Name, &asset.Prompt, &asset.ReferenceObjectKey, &asset.Source, &asset.ManuallyEdited); err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func (s *Assets) Update(ctx context.Context, ownerID int64, asset domain.Asset) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
SET a.asset_type_id = ?, a.category = ?, a.name = ?, a.prompt = ?, a.reference_object_key = ?, a.source = ?, a.manually_edited = ?
WHERE a.id = ? AND p.user_id = ?
`, asset.AssetTypeID, asset.Category, asset.Name, asset.Prompt, asset.ReferenceObjectKey, asset.Source, asset.ManuallyEdited, asset.ID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Assets) Delete(ctx context.Context, ownerID, assetID int64) error {
	result, err := s.db.ExecContext(ctx, `
DELETE a FROM shuihuo_assets a
JOIN shuihuo_projects p ON p.id = a.project_id
WHERE a.id = ? AND p.user_id = ?
`, assetID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}
var ErrInvalidAssetGenerationAspectRatio = errors.New("invalid asset generation aspect ratio")


func (s *Assets) SaveGenerationConfig(ctx context.Context, ownerID, projectID int64, config domain.AssetGenerationConfig) error {
	if !validAssetGenerationAspectRatio(config.AspectRatio) {
		return ErrInvalidAssetGenerationAspectRatio
	}
	result, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_asset_generation_configs(
  project_id, user_id, text_model_id, image_model_id, audio_model_id, prompt_template_id,
  character_preset_id, scene_preset_id, aspect_ratio, style_reference_media_id, three_view
)
SELECT p.id, p.user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM shuihuo_projects p
WHERE p.id = ? AND p.user_id = ?
ON DUPLICATE KEY UPDATE
  text_model_id = VALUES(text_model_id),
  image_model_id = VALUES(image_model_id),
  audio_model_id = VALUES(audio_model_id),
  prompt_template_id = VALUES(prompt_template_id),
  character_preset_id = VALUES(character_preset_id),
  scene_preset_id = VALUES(scene_preset_id),
  aspect_ratio = VALUES(aspect_ratio),
  style_reference_media_id = VALUES(style_reference_media_id),
  three_view = VALUES(three_view)
`, config.TextModelID, config.ImageModelID, config.AudioModelID, config.PromptTemplateID,
		config.CharacterPresetID, config.ScenePresetID, config.AspectRatio, config.StyleReferenceMediaID, config.ThreeView, projectID, ownerID)
	if err != nil {
		return err
	}
	return requireAffected(result)
}

func (s *Assets) GetGenerationConfig(ctx context.Context, ownerID, projectID int64) (domain.AssetGenerationConfig, error) {
	var config domain.AssetGenerationConfig
	err := s.db.QueryRowContext(ctx, `
SELECT c.project_id, c.text_model_id, c.image_model_id, c.audio_model_id, c.prompt_template_id,
       c.character_preset_id, c.scene_preset_id, c.aspect_ratio, c.style_reference_media_id,
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
