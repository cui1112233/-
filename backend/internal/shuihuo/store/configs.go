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
SELECT character_prefix, image_prefix, image_suffix, video_prefix, video_suffix,
       text_model_id, image_model_id, video_model_id, audio_model_id, jianying_draft_directory
FROM shuihuo_user_configs
WHERE user_id = ?
`, userID).Scan(
		&config.CharacterPrefix,
		&config.ImagePrefix,
		&config.ImageSuffix,
		&config.VideoPrefix,
		&config.VideoSuffix,
		&config.TextModelID,
		&config.ImageModelID,
		&config.VideoModelID,
		&config.AudioModelID,
		&config.JianyingDraftDirectory,
	)
	if err == sql.ErrNoRows {
		return config, nil
	}
	return config, err
}

func (s *ProductionConfigs) Save(ctx context.Context, config domain.UserProductionConfig) (domain.UserProductionConfig, error) {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO shuihuo_user_configs(
  user_id, character_prefix, image_prefix, image_suffix, video_prefix, video_suffix,
  text_model_id, image_model_id, video_model_id, audio_model_id, jianying_draft_directory
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  character_prefix = VALUES(character_prefix),
  image_prefix = VALUES(image_prefix),
  image_suffix = VALUES(image_suffix),
  video_prefix = VALUES(video_prefix),
  video_suffix = VALUES(video_suffix),
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
