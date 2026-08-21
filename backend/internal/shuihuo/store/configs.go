package store

import (
	"context"
	"database/sql"

	"qiantie/backend/internal/shuihuo/domain"
)

type ProductionConfigs struct{ db *sql.DB }

func NewProductionConfigs(db *sql.DB) *ProductionConfigs { return &ProductionConfigs{db: db} }

func (s *ProductionConfigs) Get(ctx context.Context, userID int64) (domain.UserProductionConfig, error) {
	config := domain.UserProductionConfig{UserID: userID}
	err := s.db.QueryRowContext(ctx, `
		SELECT character_prefix, image_prefix, image_suffix, video_prefix, video_suffix, video_generation_mode,
		image_aspect_ratio, image_resolution, video_aspect_ratio, video_resolution,
       text_model_id, image_model_id, video_model_id, audio_model_id, jianying_draft_directory
FROM shuihuo_user_configs
WHERE user_id = ?
`, userID).Scan(
		&config.CharacterPrefix,
		&config.ImagePrefix,
		&config.ImageSuffix,
		&config.VideoPrefix,
		&config.VideoSuffix,
		&config.VideoGenerationMode,
		&config.ImageAspectRatio,
		&config.ImageResolution,
		&config.VideoAspectRatio,
		&config.VideoResolution,
		&config.TextModelID,
		&config.ImageModelID,
		&config.VideoModelID,
		&config.AudioModelID,
		&config.JianyingDraftDirectory,
	)
	if err == sql.ErrNoRows {
		config.VideoGenerationMode = domain.VideoGenerationModeImage
		config.ImageAspectRatio = domain.DefaultImageAspectRatio
		config.ImageResolution = domain.DefaultImageResolution
		config.VideoAspectRatio = domain.DefaultVideoAspectRatio
		config.VideoResolution = domain.DefaultVideoResolution
		return config, nil
	}
	if err == nil {
		config.VideoGenerationMode, err = domain.NormalizeVideoGenerationMode(config.VideoGenerationMode)
		if err == nil {
			config.ImageAspectRatio, err = domain.NormalizeImageAspectRatio(config.ImageAspectRatio)
		}
		if err == nil {
			config.ImageResolution, err = domain.NormalizeImageResolution(config.ImageResolution)
		}
		if err == nil {
			config.VideoAspectRatio, err = domain.NormalizeVideoAspectRatio(config.VideoAspectRatio)
		}
		if err == nil {
			config.VideoResolution, err = domain.NormalizeVideoResolution(config.VideoResolution)
		}
	}
	return config, err
}

func (s *ProductionConfigs) Save(ctx context.Context, config domain.UserProductionConfig) (domain.UserProductionConfig, error) {
	mode, err := domain.NormalizeVideoGenerationMode(config.VideoGenerationMode)
	if err != nil {
		return domain.UserProductionConfig{}, err
	}
	config.VideoGenerationMode = mode
	if config.ImageAspectRatio, err = domain.NormalizeImageAspectRatio(config.ImageAspectRatio); err != nil {
		return domain.UserProductionConfig{}, err
	}
	if config.ImageResolution, err = domain.NormalizeImageResolution(config.ImageResolution); err != nil {
		return domain.UserProductionConfig{}, err
	}
	if config.VideoAspectRatio, err = domain.NormalizeVideoAspectRatio(config.VideoAspectRatio); err != nil {
		return domain.UserProductionConfig{}, err
	}
	if config.VideoResolution, err = domain.NormalizeVideoResolution(config.VideoResolution); err != nil {
		return domain.UserProductionConfig{}, err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO shuihuo_user_configs(
  user_id, character_prefix, image_prefix, image_suffix, video_prefix, video_suffix, video_generation_mode,
	  image_aspect_ratio, image_resolution, video_aspect_ratio, video_resolution,
  text_model_id, image_model_id, video_model_id, audio_model_id, jianying_draft_directory
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  character_prefix = VALUES(character_prefix),
  image_prefix = VALUES(image_prefix),
  image_suffix = VALUES(image_suffix),
  video_prefix = VALUES(video_prefix),
	  video_suffix = VALUES(video_suffix),
	  video_generation_mode = VALUES(video_generation_mode),
	  image_aspect_ratio = VALUES(image_aspect_ratio),
	  image_resolution = VALUES(image_resolution),
	  video_aspect_ratio = VALUES(video_aspect_ratio),
	  video_resolution = VALUES(video_resolution),
  text_model_id = VALUES(text_model_id),
  image_model_id = VALUES(image_model_id),
  video_model_id = VALUES(video_model_id),
  audio_model_id = VALUES(audio_model_id),
  jianying_draft_directory = VALUES(jianying_draft_directory)
`,
		config.UserID,
		config.CharacterPrefix,
		config.ImagePrefix,
		config.ImageSuffix,
		config.VideoPrefix,
		config.VideoSuffix,
		config.VideoGenerationMode,
		config.ImageAspectRatio,
		config.ImageResolution,
		config.VideoAspectRatio,
		config.VideoResolution,
		config.TextModelID,
		config.ImageModelID,
		config.VideoModelID,
		config.AudioModelID,
		config.JianyingDraftDirectory,
	)
	if err != nil {
		return domain.UserProductionConfig{}, err
	}
	return config, nil
}
